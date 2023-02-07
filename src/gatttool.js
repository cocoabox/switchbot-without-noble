const {spawn} = require('child_process');

/**
 * @param {number} msec
 * @returns {Promise<unknown>}
 */
function sleep(msec) {
    return new Promise(resolve => {
        setTimeout(() => resolve() , msec);
    });
}

function char_properties(hex) {
    const properties = {
        BLE_GATT_CHAR_PROPERTIES_NONE : 0x00 ,
        BLE_GATT_CHAR_PROPERTIES_BROADCAST : 0x01 , //**< Permits broadcasts of the characteristic value using the Server Characteristic Configuration descriptor. */
        BLE_GATT_CHAR_PROPERTIES_READ : 0x02 , //**< Permits reads of the characteristic value. */
        BLE_GATT_CHAR_PROPERTIES_WRITE_WITHOUT_RESPONSE : 0x04 , //**< Permits writes of the characteristic value without response. */
        BLE_GATT_CHAR_PROPERTIES_WRITE : 0x08 , //**< Permits writes of the characteristic value with response. */
        BLE_GATT_CHAR_PROPERTIES_NOTIFY : 0x10 , //**< Permits notifications of a characteristic value without acknowledgment. */
        BLE_GATT_CHAR_PROPERTIES_INDICATE : 0x20 , //**< Permits indications of a characteristic value with acknowledgment. */
        BLE_GATT_CHAR_PROPERTIES_AUTHENTICATED_SIGNED_WRITES : 0x40 , //**< Permits signed writes to the characteristic value. */
        BLE_GATT_CHAR_PROPERTIES_EXTENDED_PROPERTIES : 0x80  //**< Additional characteristic properties are defined in the Characteristic Extended Properties descriptor */
    };
    const user_value = parseInt(hex , 16);
    return Object.entries(properties)
        .map(([name , bitmask]) => parseInt(bitmask & user_value) === bitmask ? name : '')
        .filter(n => !! n);
}

/**
 * @callback async_func
 * @return {Promise}
 *
 */
/**
 * @callback async_func_return_strings
 * @return {Promise<{output:string[]}>}
 *
 */
/**
 * @callback sleep
 * @param {number} msec
 * @return {Promise}
 *
 */

/**
 * @callback send_and_expect
 * @param {string} send
 * @param {RegExp|string} expect
 * @param {number?} timeout
 * @param {number?} interval
 * @return {Promise<{output:string[]}>}
 */
/**
 * runs gatttool in faux-interactive mode
 * @param {string} hci_name
 *      usually this is "hci0"
 * @param {string|{random:string}} mac
 *      MAC_ADDRESS of the device
 *      to provide a -t random -b MAC_ADDRESS , pass {random:MAC_ADDRESS}
 * @param {function({send_and_expect:send_and_expect,exit:async_func,sleep:sleep,connect:async_func_return_strings})} operations
 *      things to do once gatt is open; resolve if everything works, or reject/throw if something goes wrong
 * @returns {Promise<number>}
 *      resolves if user operations all went well successfully
 *      rejects if gatttool fails to run, or if user operations threw an exception
 */
function gatttool(hci_name , mac , operations) {
    // console.warn('gatttool' , {hci_name , mac , operations});
    return new Promise(async (resolve , reject) => {
        const gatttool_args = mac.random
            ? ['-t' , 'random' , '-b' , mac.random.toUpperCase() , '-i' , 'hci1' , '-I']
            : ['-b' , mac.toUpperCase() , '-i' , 'hci1' , '-I'];
        const mac_address = mac.random ? mac.random.toUpperCase() : mac.toUpperCase();
        const child = spawn('gatttool' , gatttool_args);
        child.on('error' , error => {
            console.warn('gatttool error' , error);
            reject({error});
        });
        child.stdout.setEncoding('utf8');
        await sleep(500);
        const last_stdout = [];
        child.stdout.on('data' , (data) => {
            const lines = data.split('\n').map(str => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g , '').trim());
            // console.log(`stdout:` , lines);
            for ( let line of lines ) {
                last_stdout.push(line);
            }
        });
        child.on('close' , (code) => {
            resolve(code);
        });
        const expect_prompt = (timeout = 5000 , interval = 200) => new Promise(async (resolve , reject) => {
            const timeout_timer = setTimeout(() => {
                const output = [...last_stdout];
                reject({timeout : true , output});
            } , timeout);
            while (true) {
                const got_prompt = last_stdout[last_stdout.length - 1] === `[${mac_address}][LE]>`;
                if ( got_prompt ) {
                    clearTimeout(timeout_timer);
                    const output = [...last_stdout];
                    output.pop(); // remove the last prompt
                    return resolve(output);
                }
                await sleep(interval);
            }
        });
        /**
         *
         * @param {string} send
         * @param {RegExp|string?} expect
         * @param {string} success_message
         * @param {number?} timeout
         * @param {number?} interval
         * @returns {Promise<unknown>}
         */
        const send_and_expect = (send , {
            expect ,
            timeout ,
            interval ,
            success_message
        } = {}) => new Promise(async (se_resolve , se_reject) => {
            timeout = timeout ?? 5000;
            interval = interval ?? 200;

            child.stdin.write(`${send}\n`);
            last_stdout.length = 0;
            const captured_result = {};
            const timeout_timer = setTimeout(() => {
                const output = [...last_stdout];
                se_reject(Object.assign({} , {timeout : true , output} , captured_result));
            } , timeout);
            const msg_regex = new RegExp(`^(.*[\\r\\n]?)?(${success_message ? (success_message+'|') : ''}Error:|Comand Failed:)(.*)\$`);
            const matches = [];
            while (true) {
                // every interval msec, check current stdout to find matching line, may it be "expect" or "msg_regex"
                await sleep(interval);
                let expectation_met = false;
                for ( const line of last_stdout ) {
                    const msg_mat = line.match(msg_regex);
                    if ( msg_mat ) {
                        const lhs = msg_mat[2]?.trim();
                        const details = msg_mat[3]?.trim();
                        if ( lhs === success_message ) {
                            captured_result.success = true;
                        } else {
                            captured_result.error = details;
                        }
                    }
                    if ( typeof expect === 'string' && line === expect ) {
                        expectation_met = true;
                    } else if ( expect instanceof RegExp ) {
                        const match = line.match(expect);
                        if ( match ) {
                            matches.push(match);
                            expectation_met = true;
                        }
                    }
                } // end for each line of last_stdout
                const got_prompt = last_stdout[last_stdout.length - 1] === `[${mac_address}][LE]>`;
                if ( (got_prompt && expectation_met) || (captured_result.success || captured_result.error) ) {
                    clearTimeout(timeout_timer);
                    const output = [...last_stdout];
                    if ( captured_result.error )
                        return se_reject(Object.assign({} , {output , matches} , captured_result));
                    else
                        return se_resolve(Object.assign({} , {output , matches} , captured_result));
                }
            }
        });
        let exited = false;
        const exit = async () => {
            exited = true;
            child.stdin.write('exit\n');
            child.stdin.pause();
            child.stdin.end();
            await sleep(250);
            child.kill();
        };
        const connect = async () => {
            const {output , success , error} = await send_and_expect(
                'connect' , {success_message : 'Connection successful'});
            if ( success ) return {success : true};
            else throw {output , error};
        };
        const char_write_req = async (value_handle , value) => {
            const {output , success , error} = await send_and_expect(`char-write-req ${value_handle} ${value}` , {
                success_message : 'Characteristic value was written successfully' ,
            });
            if ( success ) {
                // output contains success message AND write result
                const output_values = output.map(o => o.match(/^Notification handle = (0x[0-9a-f]+) value: (.*)$/))
                    .filter(n => !! n)?.[0]?.[2]?.split(' ').map(n => parseInt(n , 16));
                return {output , success : true , output_values};
            } else if ( error ) {
                throw {output , error};
            } else {
                throw {output , error : 'unknown-output'};
            }
        };
        const characteristics = async () => {
            const char_output_regex = /^(.*[\r\n]?)?handle: (.*?), char properties: (.*?), char value handle: (.*)?, uuid: (.*)$/;
            const {output , matches} = await send_and_expect('characteristics' , {expect : char_output_regex});
            const characteristics = matches.map(mat => {
                return {
                    char_handle : mat[2] ,
                    char_properties : mat[3] ,
                    char_properties_list : char_properties(mat[3]) ,
                    value_handle : mat[4] ,
                    uuid : mat[5] ,
                };
            });
            return {output , characteristics , success : true};
        };

        try {
            await expect_prompt();
        } catch (error) {
            reject({error : 'timeout-waiting-for-prompt'});
        }
        try {
            const result = operations({connect , send_and_expect , exit , sleep , char_write_req , characteristics});
            const promise = result.then ? result : Promise.resolve(result);
            await result;
            if ( ! exited ) {
                await exit();
            }
        } catch (error) {
            reject({error : 'operations-error' , reason : error});
        }
    });
}

module.exports = {gatttool , sleep};
