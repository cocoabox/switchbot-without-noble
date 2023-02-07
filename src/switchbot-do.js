const {gatttool} = require('./gatttool');

// all switchbot devices exposes this characteristic for receiving user commands
const char_uuid = 'cba20002-224d-11e6-9fb8-0002a5d5c51b';
// this characteristic should be writeable
const expected_char_property = 'BLE_GATT_CHAR_PROPERTIES_WRITE';

// https://stackoverflow.com/questions/17204335/convert-decimal-to-hex-missing-padded-0
function tohex(int) {
    return (int / 256 + 1 / 512).toString(16).substring(2 , 4);
}

/**
 *
 * @param hci_name
 * @param mac
 * @param char_uuid
 * @param expected_char_property
 * @param write_value
 * @param max_retries
 * @returns {Promise<{success: boolean, response, gatttool_exit_value: number}>}
 */
async function switchbot_do(hci_name , mac , write_value , {max_retries} = {}) {
    // console.warn('switchbot_do' , {hci_name , mac , write_value , max_retries});
    max_retries = max_retries ?? 20;
    try {
        let response;
        const gatttool_exit_value = await gatttool(hci_name , mac ,
            async ({
                       connect ,
                       exit ,
                       sleep ,
                       char_write_req ,
                       characteristics
                   }
            ) => {
                let retries = 0;
                // issue gatt connect command
                // console.warn('connect');
                while (true) {
                    try {
                        await connect();
                        break;
                    } catch (err) {
                        // console.warn('failed to connect' , err);
                        await sleep(500);
                    }
                    if ( ++retries > max_retries ) {
                        console.warn('failed to connect, give up');
                        throw {where : 'connect' , give_up : true};
                    }
                }
                // find the characteristic we're gonna use
                let value_handle;
                while (true) {
                    // first issue the gatt characteristics command and get parsed result
                    const all_chars = await (async () => {
                        // console.warn('getting all characteristics');
                        get_chars_retries = 0;
                        while (true) {
                            try {
                                return await characteristics();
                                break;
                            } catch (err) {
                                console.warn('error getting all characteristics' , err);
                                if ( err.error ) {
                                    throw {where : 'characteristics' , 'fatal-error' : err.error};
                                }
                                if ( ++get_chars_retries > max_retries ) {
                                    console.warn('failed to get characteristics, give up');
                                    throw {where : 'characteristics' , give_up : true};
                                }
                                await sleep(500);
                            }
                        }
                    })();
                    // next find the char with specific UUID
                    // console.warn('all chars' , JSON.stringify(all_chars , '' , 4));
                    value_handle = all_chars?.characteristics.find(c => c.uuid === char_uuid
                        && c.char_properties_list.includes(expected_char_property))?.value_handle;
                    // got it ? leave loop
                    // console.warn('value_handle' , value_handle);
                    if ( value_handle ) break;
                    // couldn't find value, try again after 500 msec
                    if ( ++retries > max_retries ) {
                        console.warn('failed to find characteristics, give up');
                        throw {where : 'characteristic-find' , give_up : true};
                    }
                    await sleep(500);
                }
                // write characteristic to toggle the device
                retries = 0;
                while (true) {
                    // console.warn('char_write_req' , value_handle , write_value);
                    try {
                        response = await char_write_req(value_handle , write_value);
                        break;
                    } catch (err) {
                        console.warn('error while char_write_req' , err);
                        if ( err.error ) {
                            throw {where : 'char-write-req' , 'fatal-error' : err.error};
                        }
                        if ( ++retries > max_retries ) {
                            console.warn('failed to write, give up');
                            throw {where : 'char-write-req' , give_up : true};
                        }
                        await sleep(500);
                    }
                }
                // close gatttool
                await exit();
            });
        return {success : true , response , gatttool_exit_value};
    } catch (operation_error) {
        throw {operation_error};
    }
}

/**
 *
 * @param {string} hci_name
 * @param {string} mac
 * @param {string|{percent:number,mode:string?}} curtain_command
 *      available commands: "open" "close" "pause" or {percent:PERCENT_NUM, mode: MODE_STR}
 *      MODE_STR should be: "performance"(default) "silence"
 *      PERCENT_NUM should be: 0..100
 * @param {number?} max_retries
 * @returns {Promise<boolean>}
 */
async function switchbot_curtain_do(hci_name , mac , curtain_command , {max_retries} = {}) {
    const generate_write_value = ({percent , mode} = {}) => {
        const mode_num = {
            performance : 0 ,
            silence : 1 ,
        }[mode] ?? 0;
        const percent_num = percent > 100 ? 100 : percent < 0 ? 0 : percent;

        return [0x57 , 0x0f , 0x45 , 0x01 , 0x05 , mode_num , percent_num];
    };
    const write_value_ints = typeof curtain_command === 'string' ? {
        open : [0x57 , 0x0f , 0x45 , 0x01 , 0x05 , 0xff , 0x00] ,
        close : [0x57 , 0x0f , 0x45 , 0x01 , 0x05 , 0xff , 0x64] ,
        pause : [0x57 , 0x0f , 0x45 , 0x01 , 0x00 , 0xff] ,
    }[curtain_command] : generate_write_value(curtain_command);
    if ( ! write_value_ints ) throw {error : 'invalid-command'};
    const write_value_hex_str = write_value_ints.map(n => tohex(n)).join('');
    console.log('calling switchbot_do' , hci_name , {random : mac} , write_value_hex_str , {max_retries});
    const response = await switchbot_do(hci_name , {random : mac} , write_value_hex_str , {max_retries});

    if ( response?.success ) {
        return true;
    } else {
        throw {error : 'unexpected-response' , response};
    }
}

/**
 * @see https://github.com/OpenWonderLabs/SwitchBotAPI-BLE/blob/latest/devicetypes/bot.md
 * @param hci_name
 * @param mac
 * @param {string} bot_command
 *      should be either: "on" "off" "press" "down" "up"
 * @param max_retries
 * @returns {Promise<boolean>}
 */
async function switchbot_bot_do(hci_name , mac , bot_command , {max_retries} = {}) {
    const write_value = {
        on : '570101' ,
        off : '570102' ,
        press : '570100' ,
        down : '570103' ,
        up : '570104' ,
    }[bot_command];
    if ( ! write_value ) throw {error : 'invalid-command'};
    const response = await switchbot_do(hci_name , {random : mac} , write_value , {max_retries});
    if ( response?.success ) {
        return true;
    } else {
        throw {error : 'unexpected-response' , response};
    }
}

/**
 * performs a Write+GetResponse action on a PlugMini
 * @see https://github.com/OpenWonderLabs/SwitchBotAPI-BLE/blob/latest/devicetypes/plugmini.md
 * @param {string} hci_name hci adapter name, should be something like "hci0" or "hci1"
 * @param {string} mac bluetooth mac address to the device
 * @param {string} plugmini_command should be either "on" "off" or "toggle"
 * @param {number?} max_retries max retries for each gatt command, default 20
 * @returns {Promise<string>} resolves with "on" or "off" depending on the final state of the plugmini
 */
async function switchbot_plugmini_do(hci_name , mac , plugmini_command , {max_retries} = {}) {
    const write_value = {
        on : '570f50010180' ,
        off : '570f50010100' ,
        toggle : '570f50010280' ,
    }[plugmini_command];
    if ( ! write_value ) throw {error : 'invalid-command'};
    const out = await switchbot_do(hci_name , mac , write_value , {max_retries});

    switch ((out?.response?.output_values?.[0] ?? 0) << 8 | (out?.response?.output_values?.[1] ?? 0)) {
        case 0x0180:
            return 'on';
        case 0x0100:
            return 'off';
        default:
            throw {error : 'unexpected-response' , response : out};
    }
}

module.exports = {
    switchbot_do ,
    switchbot_plugmini_do ,
    switchbot_bot_do ,
    switchbot_curtain_do ,
};
