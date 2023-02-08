const child_process = require('child_process');
const {EventEmitter} = require('events');
const ble_packet_parser = require('ble-packet-parser');

function sleep(msec) {
    return new Promise(resolve => {
        setTimeout(() => resolve() , msec);
    });
}

function my_spawn(cmd , args , {on_stdout , on_stderr , on_exit , on_spawn , resolve_on_close} = {}) {
    return new Promise((resolve , reject) => {
        // console.warn('Run:' , cmd , args.join(' '));
        const child = child_process.spawn(cmd , args);
        child.stdout.setEncoding('utf8');
        if ( on_stdout ) child.stdout.on('data' , on_stdout);
        child.stderr.setEncoding('utf8');
        if ( on_stderr ) child.stderr.on('data' , on_stderr);
        if ( on_exit ) child.on('exit' , on_exit);
        child.on('error' , error => reject({cmd , args , error}));
        child.on('spawn' , resolve_on_close ? () => on_spawn : () => resolve(child));
        if ( resolve_on_close ) {
            child.on('close' , (exit_code) => {
                if ( exit_code === 0 ) resolve();
                else reject({exit_code , cmd , args});
            });
        }
    });
}

let last = '';

class Lescan extends EventEmitter {
    #hci_device_name;

    #log;
    #warn;

    constructor(hci_device_name = 'hci0' , {log , warn} = {}) {
        super();
        this.#log = typeof log === 'function' ? log : () => {
        };
        this.#warn = typeof warn === 'function' ? warn : () => {
        };
        this.#hci_device_name = hci_device_name;
        this.#is_stopping = false;
        this.#is_stopped = true;
        this.#down_everthing_else();
    }

    async #down(hci_name) {
        const max_retry = 3;
        let last_rejection;
        for ( let i = 0; i < max_retry; ++i ) {
            try {
                await my_spawn('hciconfig' , [hci_name , 'down'] , {resolve_on_close : true});
                return;
            } catch (rejection) {
                await sleep(1000);
                last_rejection = rejection;
                continue;
            }
        }
        throw last_rejection;
    }

    async #down_everthing_else() {
        const stdout = [];
        const exit_code = await my_spawn('hciconfig' , [] , {
            on_stdout : str => stdout.push(str) ,
            resolve_on_close : true ,
        });
        const hci_devices = Object.fromEntries(stdout.join('').split('\n\n')
            .map(dev => dev.replaceAll(/[\n\t]/g , ' '))
            .map(str => str.match(/^(.*?):.*?BD Address: (.*?) /))
            .map(mat => mat ? [mat[1] , mat[2]] : null)
            .filter(n => !! n)
        );
        this.#log('hci devices :' , hci_devices);
        const down_these = Object.keys(hci_devices).filter(hci_name => hci_name !==  this.#hci_device_name);
        for ( const down_this of down_these ) {
            this.#log('hci down :' , down_this);
            await this.#down(down_this);
        }
    }

    #hcidump_process;
    #lescan_process;

    #merged_dumps;

    #on_hcidump_received(int_array) {
        const parsed = ble_packet_parser(int_array , true);
        this.emit('received' , parsed);

        // one advertisement is split into multiple packets .. temporally combine them?
        // see #report_dumps_timer
        for ( const report of parsed?.Reports ?? [] ) {
            const {address} = report;
            if ( ! this.#merged_dumps[address] ) {
                this.#merged_dumps[address] = [];
            }
            this.#merged_dumps[address].push(report);
        }
    }

    #report_dumps_timer;

    #setup_report_dumps_timer() {
        const schedule_next = () => {
            this.#report_dumps_timer = setTimeout(report_dumps , 1000);
        };
        const report_dumps = () => {
            for ( const [address , reports] of Object.entries(this.#merged_dumps) ) {
                this.emit('received-merge' , {address , reports});
            }
            this.#merged_dumps = {};
            schedule_next();
        };
        schedule_next();
    }

    #is_stopping;
    #is_stopped;

    async reset() {
        const max_retry = 3;
        let last_rejection;
        for ( let i = 0; i < max_retry; ++i ) {
            try {
                await my_spawn('hciconfig' , [this.#hci_device_name , 'down'] , {resolve_on_close : true});
                await sleep(200);
                await my_spawn('hciconfig' , [this.#hci_device_name , 'up'] , {resolve_on_close : true});
                await sleep(200);
                return;
            } catch (rejection) {
                await sleep(1000);
                last_rejection = rejection;
                continue;
            }
        }
        throw last_rejection;
    }

    async grand_reset() {
        const max_retry = 3;
        let last_rejection;
        for ( let i = 0; i < max_retry; ++i ) {
            try {
                await my_spawn('service' , ['bluetooth' , 'restart'] , {resolve_on_close : true});
                await sleep(200);
                await my_spawn('service' , ['dbus' , 'restart'] , {resolve_on_close : true});
                await sleep(200);
                return;
            } catch (rejection) {
                await sleep(1000);
                last_rejection = rejection;
                continue;
            }
        }
        throw last_rejection;
    }

    /**
     * starts dumping; returns a Promise that resolves once dumping has started.
     * if command not found or hci interface not found, then rejects
     * @returns {Promise}
     */
    async start() {
        // console.warn('lescan start');
        if ( (! this.#is_stopped) || this.#is_stopping ) {
            console.warn('not stopped, or is stopping');
            throw {error : 'not-stopped'};
        }
        this.#merged_dumps = {};
        this.#is_stopping = false;
        this.#is_stopped = false;

        try {
            this.#hcidump_process = await my_spawn('hcidump' , ['-x' , '-R' , '-i' , this.#hci_device_name] ,
                {
                    on_exit : async (exit_code) => {
                        this.#hcidump_process = null;
                        if ( ! this.#is_stopping ) {
                            console.log('hcidump stopped unexpectedly' , exit_code);
                            await this.stop();
                            this.#emit_terminated();
                        }
                    } ,
                    on_stdout : (str) => {
                        const lines = [];
                        const to_parse = last + str;
                        const joined = to_parse.split('\n').map(line => line.trim()).join(' ');
                        const mats = joined.matchAll(/([<>])([^<>]+)/g);
                        for ( const mat of mats ) {
                            const int_array =
                                mat[2].split('\n').join(' ').trim().split(' ')
                                    .filter(n => !! n.trim()).map(n => parseInt(n , 16));
                            lines.push([mat[1].trim() , int_array , mat[2]]);
                        }
                        if ( lines.length > 0 ) {
                            const [caret , , orig_str] = lines.pop();
                            last = `${caret} ` + orig_str + ' ';
                            lines.filter(([caret ,]) => caret === '>').forEach(([, int_array]) => {
                                this.#on_hcidump_received(int_array);
                            });
                        }
                    } ,
                    on_stderr : (str) => {
                        console.warn('hcidump:' , str);
                    } ,
                });
            // console.warn('#hcidump_process:' , this.#hcidump_process);

            this.#lescan_process = await my_spawn('hcitool' , ['lescan' , '--duplicates' , '--discovery=g'] ,
                {
                    on_exit : async (exit_code) => {
                        this.#lescan_process = null;
                        if ( ! this.#is_stopping ) {
                            console.warn('hcitool stopped unexpectedly' , exit_code);
                            await this.stop();
                            this.#emit_terminated();
                        }
                    } ,
                    on_stderr : (str) => {
                        console.warn('hcitool:' , str);
                    } ,
                });
            // console.warn('#lescan_process:' , this.#lescan_process);

        } catch (e) {
            const {cmd , error} = e;
            throw {error : 'spawn-error' , cmd , reason : error};
        }
        this.#setup_report_dumps_timer();
    }

    /**
     * when either lescan/hcidump process terminates, one or more calls to emit_terminated() will be made
     * avoid this by setting a timer
     */
    #emit_terminate_timer;

    #emit_terminated() {
        if ( this.#emit_terminate_timer ) clearTimeout(this.#emit_terminate_timer);
        this.#emit_terminate_timer = setTimeout(() => {
            this.emit('terminated');
            this.#emit_terminate_timer = null;
        } , 500);
    }

    /**
     * stops dumping. you should always call this method when you want to stop scan
     * and  before your app closes
     */
    async stop() {
        if ( this.#is_stopped ) return;
        clearTimeout(this.#report_dumps_timer);
        this.#is_stopping = true;
        if ( this.#hcidump_process ) {
            // console.log('killing hcidump');
            this.#hcidump_process.kill(15);
        }
        if ( this.#lescan_process ) {
            // console.log('killing lescan');
            this.#lescan_process.kill(15);
        }
        this.#hcidump_process = null;
        this.#lescan_process = null;
        await sleep(200);
        this.emit('stopped');
        this.#is_stopping = false;
        this.#is_stopped = true;
    }

}

module.exports = Lescan;
