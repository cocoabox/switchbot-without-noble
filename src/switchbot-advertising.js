const SwitchbotAdvertising = (() => {
    try {
        return require('../../node-switchbot/lib/switchbot-advertising');
    } catch (error) {
        return require('../node_modules/node-switchbot/lib/switchbot-advertising');
    }
})();

module.exports = SwitchbotAdvertising;
