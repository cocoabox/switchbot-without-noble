const SwitchbotAdvertising = require('../node_modules/node-switchbot/lib/switchbot-advertising');
const {EventEmitter} = require('events');

class SwitchbotScanShared extends EventEmitter {

    #lescan;

    constructor(lescan) {
        super();
        this.#lescan = lescan;
        this.#lescan.on('received-merge' , this.#process_merged.bind(this));
    }

    #process_merged({address , reports}) {
        const rssi_arr = reports.map(r => r?.rssi).filter(n => !! n);
        const avg_rssi = rssi_arr.reduce((a , b) => a + b , 0) / rssi_arr.length;
        const combined_data = [].concat(reports.map(r => r?.data ?? [])).flat();
        const manu_data = combined_data.find(cd => cd?.fieldType === 0xFF)?.data;
        const serv_data = combined_data.find(cd => cd?.fieldType === 0x16)?.data?.data;
        if ( manu_data && serv_data ) {
            // construct a fake noble-ish peripheral object for SwitchbotAdvertising to parse
            const peripheral = {
                rssi : Math.round(avg_rssi) ,
                advertisement : {
                    serviceData : [
                        {data : serv_data ? Buffer.from(serv_data.reverse()) : null} ,
                    ] ,
                    manufacturerData : manu_data ? Buffer.from(manu_data) : null ,
                }
            };
            const parsed = SwitchbotAdvertising.parse(peripheral);
            if ( parsed ) {
                this.emit('switchbot-advertisement' , parsed);
            }
        }
    }
}

module.exports = SwitchbotScanShared;
