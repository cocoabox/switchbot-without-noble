const getopts = require('getopts');
const SwitchbotScan = require('./src/switchbot-scan');
const switchbot_do = require('./src/switchbot-do');

module.exports = Object.assign({} , switchbot_do , {SwitchbotScan});

async function do_scan(options) {
    const {hci , time} = options;
    if ( ! hci ) {
        console.warn('missing --hci ');
        process.exit(1);
    }
    const scan_duration = time ? parseInt(time) : null;
    if ( isNaN(scan_duration) ) {
        console.warn('invalid --time :' , time);
        process.exit(1);
    }
    const scanner = new SwitchbotScan(hci);
    const bye = async () => {
        console.warn('GOODBYE');
        await scanner.stop();
        process.exit(0);
    };
    process.on('SIGINT' , bye);
    process.on('SIGTERM' , bye);
    try {
        scanner.on('switchbot-advertisement' , (ad) => {
            console.log(JSON.stringify(ad));
        });
        await scanner.start();
        if ( typeof scan_duration === 'number' )
            setTimeout(async () => {
                scanner.stop();
                bye();
            } , parseInt(scan_duration) * 1000);
    } catch (err) {
        console.warn('SORRY:' , err);
        process.exit(2);
    }
}

async function do_operate(options) {
    const {hci , mac , max_retries , device , command} = Object.assign({
        max_retries : 20 ,
    } , options);
    try {
        let res;
        switch (device) {
            case 'bot':
                res = await switchbot_do.switchbot_bot_do(hci , mac , command , {max_retries});
                break;
            case 'curtain':
                const curtain_cmd = command?.[0] === '{' ? JSON.parse(command) : command;
                res = await switchbot_do.switchbot_curtain_do(hci , mac , curtain_cmd , {max_retries});
                break;
            case 'plugmini':
                res = await switchbot_do.switchbot_plugmini_do(hci , mac , command , {max_retries});
                break;
            default:
                throw `invalid --device : ${device}`;
        }
        console.log(res);
        process.exit(0);
    } catch (error) {
        console.warn(JSON.stringify(error));
        process.exit(1);
    }

}

if ( require.main === module ) {
    (async () => {
        const command = process.argv.splice(2 , 1)?.[0]?.toLowerCase();
        if ( ! command ) {
            console.warn(`usage: node ${process.argv[1]} [COMMAND] [OPTS]`);
            process.exit(1);
        }
        const options = getopts(process.argv.slice(2) , {
            alias : {
                'max_retries' : 'r' ,
                'hci' : 'i' ,
                'mac' : ['b' , 'm'] ,
                'command' : 'c' ,
                'time' : 't' ,
                'device' : 'd' ,
            }
        });
        if ( ! options.hci ) {
            options.hci = 'hci0';
        }
        switch (command) {
            case 'scan':
                await do_scan(options);
                break;
            case 'do':
                await do_operate(options);
        }
    })();
}
