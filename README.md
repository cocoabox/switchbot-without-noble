# switchbot-without-noble

switchbot-without-noble is a nodejs package/command line tool that provides limited functionalities to scan/operate select switchbot
devices without Noble.
Noble is way too unsable and unreliable for production use.

Linux and hcitools and gatttool are required.

## prerequesites

Make sure you have the `hcitool` `hcidump` and `gatttool` commands installed on your linux system.

## installation

```sh 
git clone "https://github.com/cocoabox/switchbot-without-noble"
cd switchbot-without-noble
npm i
```

## programmatic usage

First, install via npm

```shell
npm i 'github:cocoabox/switchbot-without-noble'
```
Then require using the followings:

```js 
const {switchbot_plugmini_do , switchbot_bot_do , switchbot_curtain_do, SwitchbotScan} = require('modules/switchbot-without-noble');
```
To scan for advertisements, 

```js
try {
    const scanner = new SwitchbotScan('hci0');
    scanner.on('switchbot-advertisement' , (ad) => {
        // handle advertisement here 
    });
    setTimeout(() => scanner.stop() , 5000); // stop scanning
    await scanner.start();
} catch (err) {
    console.warn('error starting scan' , err);
}
```
For an example of "ad" see [advertisement output] below.

To operate your devices, **first stop scanning**, then 

```js
const bot_action_result = await switchbot_bot_do('hci0' , '00:11:22:33:44:55' , 'press' , {max_retries : 99});
```

For device commmands, see 'commands for ●●●' below.

## command line usage

### scanning for advertisements

```
node . scan -i [HCI_NAME] [-t [DURATION_SEC]] 
```

- `-i` : hci adapter name, e.g. `hci0`
- `-t` : time for which we'll scan for switchbot advertisements, omit to scan indefinitely until ^C

### advertisement output 

Each advertisement is printed on one line to stdout as JSON. The output is almost identical to the scan facilities 
provided by node-switchbot except the `.id` field is not provided here. Example (prettified):

```json
{
  "address": "11:22:33:44:55:66",
  "rssi": -77,
  "serviceData": {
    "model": "T",
    "modelName": "WoSensorTH",
    "temperature": {
      "c": 20.5,
      "f": 68.9
    },
    "fahrenheit": false,
    "humidity": 32,
    "battery": 100
  }
}
```

## operating switchbot devices

```
node . do -i [HCI_NAME] -b [MAC_ADDRESS] -d [DEVICE_TYPE] -c [DEVICE_COMMAND] [-r [MAX_RETRIES]]
```

- `-i` : hci adapter name, e.g. `hci0`
- `-b` : mac address of the device
- `-d` : device type, should be `curtain` or `bot` or `plugmini`
- `-c` : device type-specific command
- `-r` : gatttool commands occassionally fail (especially `connect`). This specifies the max retry count (default:20)

### commands for curtain

| DEVICE_COMMAND                                                     | meaning                                                                                                                             |
|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `open`                                                             | open curtain                                                                                                                        |
| `close`                                                            | open curtain                                                                                                                        |
| `{"percent":NUMBER,"mode":"MODE_STR"}` (must be valid JSON string) | run to a specific position denoted by `percent` (should be 1..100) using mode denoted by `mode` (either `performance` or `silence`) |

### commands for bot

| DEVICE_COMMAND | meaning                      |
|----------------|------------------------------|
| `press`        | press down then up           |
| `up`           | arm up                       |
| `down`         | arm down                     |
| `on`           | switch to the bot's on mode  |
| `off`          | switch to the bot's off mode |

### commands for plugmini

| DEVICE_COMMAND | meaning               |
|----------------|-----------------------|
| `off`          | turn off              |
| `on`           | turn on               |
| `toggle`       | toggle between on/off |

### output and return values

For plugmini, the final state of the device (either `on` of `off`) is printed to stdout followed by exit code `0`
For other devices, success is indicated by `true` printed to stdout followed by exit code `0`.

For error, error JSON is printed to stdout followed by non-zero exit code. Example:

```json
{ error: 'invalid-command' }
```

 
