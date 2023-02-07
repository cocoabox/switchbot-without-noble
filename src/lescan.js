const child_process = require('child_process');
const {EventEmitter} = require('events');
const ble_packet_parser = require('ble-packet-parser');

function sleep(msec) {
    return new Promise(resolve => {
        setTimeout(() => resolve() , msec);
    });
}

class Lescan extends EventEmitter {
    #hci_device_name;

    constructor(hci_device_name = 'hci0') {
        super();
        this.#hci_device_name = hci_device_name;
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

    /**
     * starts dumping; returns a Promise that resolves once dumping has started.
     * if command not found or hci interface not found, then rejects
     * @returns {Promise}
     */
    async start() {
        if ( this.#hcidump_process || this.#lescan_process ) {
            return;
        }
        this.#merged_dumps = {};
        this.#is_stopping = false;
        this.#is_stopped = false;
        const my_spawn = (cmd , args , {on_stdout , on_stderr , on_exit} = {}) =>
            new Promise((resolve , reject) => {
                // console.log('Run:' , cmd , args);
                const child = child_process.spawn(cmd , args);
                child.stdout.setEncoding('utf8');
                if ( on_stdout ) child.stdout.on('data' , on_stdout);
                child.stderr.setEncoding('utf8');
                if ( on_stderr ) child.stderr.on('data' , on_stderr);
                if ( on_exit ) child.on('exit' , on_exit);
                child.on('error' , error => reject({cmd , args , error}));
                child.on('spawn' , () => resolve(child));
            });
        let last = '';
        try {
            this.#hcidump_process = await my_spawn('hcidump' , ['-x' , '-R' , '-i' , this.#hci_device_name] ,
                {
                    on_exit : (exit_code) => {
                        this.#hcidump_process = null;
                        if ( ! this.#is_stopping ) {
                            // console.log('hcidump stopped unexpectedly' , exit_code);
                            this.stop();
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
            this.#lescan_process = await my_spawn('hcitool' , ['lescan' , '--duplicates' , '--discovery=g'] ,
                {
                    on_exit : (exit_code) => {
                        this.#lescan_process = null;
                        if ( ! this.#is_stopping ) {
                            // console.log('hcitool stopped unexpectedly' , exit_code);
                            this.stop();
                        }
                    } ,
                    on_stderr : (str) => {
                        console.warn('hcitool:' , str);
                    } ,
                });
        } catch (e) {
            const {cmd , error} = e;
            throw {error : 'spawn-error' , cmd , reason : error};
        }
        this.#setup_report_dumps_timer();
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
            this.#hcidump_process.kill(15);
        }
        if ( this.#lescan_process ) {
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
