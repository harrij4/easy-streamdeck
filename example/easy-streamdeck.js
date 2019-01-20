(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const streamdeck = require('./src');

// Running in a browser-esq context
if (window != null && window.navigator != null && window.navigator === navigator && String(navigator.appVersion) === navigator.appVersion) {

    // Add streamdeck to the window instance
    Object.defineProperty(window, 'streamdeck', {
        enumerable: true,
        value: streamdeck
    });

    // Elgato Streamdeck plugin environment
    if (navigator.appVersion.includes('QtWebEngine')) {

        // Add the connectSocket handler to the global scope
        Object.defineProperty(window, 'connectSocket', {
            value: streamdeck.start
        });
    }
}

module.exports = streamdeck;
},{"./src":2}],2:[function(require,module,exports){
const util       = require('./misc/util.js');
const Emitter    = require('./misc/emitter.js');
const Connection = require('./sdk/connection.js');
const Context    = require('./sdk/context.js');
const messages   = require('./sdk/messages.js');
const rpc        = require('./sdk/rpc.js');



const streamdeck = new Emitter();


let $ready = false,
    $port,
    $uuid,
    $layer,
    $host,
    $devices   = {},
    $contexts  = {},
    $onmessage = messages(streamdeck, $devices, $contexts),
    $conn      = new Connection();

// Members common to all layers
Object.defineProperties(streamdeck, {

    /* Read only properties */
    ready:   {enumerable: true, get: () => $ready},
    port:    {enumerable: true, get: () => $port},
    uuid:    {enumerable: true, get: () => $uuid},
    layer:   {enumerable: true, get: () => $layer},
    host:    {enumerable: true, get: () => $host},
    devices: {enumerable: true, get: () => {
        let res = [];
        Object.keys($devices).forEach(id => {
            if ($devices[id] != null) {
                res.push(Object.assign(Object.create(null), $devices[id]));
            }
        });
        return res;
    }},

    /* Read only methods */
    send: {
        enumerable: true,
        value: function send(data) {
            return $conn.send(data);
        }
    },
    sendJSON: {
        enumerable: true,
        value: function sendJSON(data) {
            return $conn.sendJSON(data);
        }
    },
    openUrl: {
        enumerable: true,
        value: function openUrl(url) {
            if (!util.isString(url, {notEmpty: true})) {
                throw new TypeError('invalid url');
            }
            $conn.sendJSON({
                event: "openUrl",
                payload: { url: url }
            });
        }
    },

    /* Initialization function */
    start: {
        enumerable: true,
        value: function init(port, uuid, registerEvent, host, context) {

            // streamdeck.start already called
            if ($ready) {
                throw new Error('start() function already called');
            }
            $ready = true;

            // validate port
            if (util.isString(port, {match: /^\d+$/i})) {
                port = Number(port);
            }
            if (!util.isNumber(port, {whole: true, min: 0, max: 65535})) {
                throw new TypeError('invalid port argument');
            }

            // validate uuid
            if (!util.isString(uuid, {notEmpty: true})) {
                throw new TypeError('invalid uuid argument');
            }

            // validate registerEvent
            if (!util.isString(registerEvent, {match: /^register(?:Plugin|PropertyInspector)$/})) {
                throw new TypeError('invalid registerEvent argument');
            }

            // Process host as JSON if its a string
            if (util.isString(host)) {
                try {
                    host = JSON.parse(host);
                } catch (e) {
                    throw new TypeError('invalid hostInfo argument');
                }
            }

            // Validate hostInfo ("inInfo")
            if (
                host == null ||
                !util.isKey(host, 'application') ||
                !util.isKey(host.application, 'language') ||
                !util.isString(host.application.language) ||
                !util.isKey(host.application, 'platform') ||
                !util.isString(host.application.platform) ||
                !util.isKey(host.application, 'version') ||
                !util.isString(host.application.version) ||
                !util.isKey(host, 'devices') ||
                !util.isArray(host.devices)
            ) {
                throw new TypeError('invalid environment argument');
            }

            // Process host.devices
            let deviceList = {};
            host.devices.forEach(device => {

                // Validate device
                if (
                    device == null ||
                    !util.isString(device.id, {match: /^[A-F\d]{32}$/}) ||
                    (device.type != null && !util.isNumber(device.type, {whole: true, min: 0})) ||
                    device.size == null ||
                    !util.isNumber(device.size.columns, {whole: true, min: 1}) ||
                    !util.isNumber(device.size.rows, {whole: true, min: 1})
                ) {
                    throw new TypeError('invalid device list');
                }

                // Store the device
                deviceList[device.id] = {
                    id: device.id,
                    type: device.type,
                    columns: device.size.columns,
                    rows: device.size.rows
                };
            });

            // Check: loaded as a Property Inspector instance
            if (registerEvent === 'registerPropertyInspector') {

                // Process context as JSON if its a string
                if (util.isString(context)) {
                    try {
                        context = JSON.parse(context);
                    } catch (e) {
                        throw new TypeError('invalid contextInfo argument');
                    }
                }

                // Validate contextInfo ("inApplicationInfo")
                if (context == null || !util.isString(context.context, {match: /^[A-F\d]{32}$/}) || !util.isString(context.action, {notEmpty: true})) {
                    throw new TypeError('invalid contextInfo argument');
                }
            }

            $port    = port;
            $uuid    = uuid;
            $host    = host.application;
            $devices = deviceList;
            $layer   = registerEvent === 'registerPlugin' ? 'plugin' : 'propertyinspector';


            // layer-based loading
            if ($layer === 'propertyinspector') {
                Object.defineProperties(streamdeck, {
                    contextId: {enumerable: true, value: context.context},
                    actionId:  {enumerable: true, value: context.action},
                    sendToPlugin: {
                        enumerable: true,
                        value: function sendToPlugin(data) {
                            streamdeck.sendJSON({
                                event:  "sendToPlugin",
                                action:  streamdeck.actionId,
                                context: streamdeck.uuid,
                                payload: data
                            });
                        }
                    }
                });

            } else {
                Object.defineProperties(streamdeck, {
                    switchToProfile: {
                        enumerable: true,
                        value: function switchToProfile(profileName) {
                            if (!util.isString(profileName)) {
                                throw new TypeError('invalid profileName argument');
                            }
                            streamdeck.sendJSON({
                                event: "switchToProfile",
                                context: streamdeck.uuid,
                                payload: {profile: profileName}
                            });
                        }
                    },
                    createContext: {
                        enumerable: true,
                        value: function createContext(action, contextId) {
                            return new Context(streamdeck, action, contextId);
                        }
                    },
                    contexts: {
                        enumerable: true,
                        get: function () {
                            let result = [];
                            Object.keys($contexts).forEach(id => {
                                if ($contexts[id] != null) {
                                    result.push($contexts[id].toSafe());
                                }
                            });

                            return result;
                        }
                    }
                });
            }

            // start connecting
            $conn.on('message', $onmessage);
            $conn.on('message', function (evt) {
                streamdeck.emit('websocket:message', evt.data);
            });
            $conn.connect(port, uuid, registerEvent);

            // emit ready event
            streamdeck.emit('ready', null, {stoppable: false, suppressError: true});
        }
    }
});

// call rpc handler
rpc(streamdeck);

// hook websocket events to re-emit on the streamdeck instance
$conn.on('connect', function () {
    streamdeck.emit('websocket:connect');
});
$conn.on('close', function (evt) {
    streamdeck.emit('websocket:close', evt);
});
$conn.on('error', function (evt) {
    streamdeck.emit('websocket:error', evt);
});
module.exports = streamdeck;
},{"./misc/emitter.js":3,"./misc/util.js":4,"./sdk/connection.js":5,"./sdk/context.js":6,"./sdk/messages.js":7,"./sdk/rpc.js":8}],3:[function(require,module,exports){
const util = require('./util.js');

const eventListenersKey = Symbol('event listeners');
const eventEmitQueueKey = Symbol('event emit queue');
const eventEmitTimeoutKey = Symbol('event emit timeout key');

const processEmitQueue = (self) => {

    // retrieve event queue for the instance
    let emitQueue = self[eventEmitQueueKey],

        // Retrieve next event to emit
        event = emitQueue.shift(),

        // Get list of handlers for the event
        listeners = self[eventListenersKey][event.name];

    // If there's more queued events to emit, start a new timeout
    if (emitQueue.length) {
        self[eventEmitTimeoutKey] = setTimeout(processEmitQueue, 1, self);

    // Otherwise null-out the timeout id
    } else {
        self[eventEmitTimeoutKey] = null;
    }

    // No registered event listeners for event
    if (listeners == null || !listeners.length) {
        return;
    }

    // Stopped tracking; set to true if the handler calls .stop()
    let stopped = false,
        eventData = Object.create(null);

    Object.defineProperties(eventData, {
        stop: {
            enumerable: true,
            value: function stop() {
                stopped = true;
            }
        },
        data: {
            enumerable: true,
            value: event.data
        }
    });

    let idx = 0;
    while (idx < listeners.length) {

        // Retrieve next listener for the event
        let listener = listeners[idx];

        // Listener is a one-time handler
        if (listener.once) {

            // Remove the handler from the event's listeners list
            listeners.splice(idx, 1);

        } else {
            idx += 1;
        }

        // Attempt to call handler
        try {
            listener.handler.call(self, eventData);

            // Listener called .stop() - exit processing
            if (stopped && event.options.stoppable !== false) {
                return;
            }

        // Handler raised error
        } catch (err) {

            // options indicate that errors should not be suppressed
            if (!event.options.suppressErrors) {

                // rethrow error
                throw err;
            }
        }
    }
};

class Emitter {
    constructor() {
        this[eventListenersKey] = {};
        this[eventEmitQueueKey] = [];
        this[eventEmitTimeoutKey] = null;
    }

    on(event, handler, isOnce) {

        // Validate event
        if (!util.isString(event, {notEmpty: true})) {
            throw new TypeError('invalid name argument');
        }

        // Validate handler
        if (!util.isCallable(handler)) {
            throw new TypeError('invalid handler argument');
        }

        // Validate isOneTimeHandler
        if (isOnce != null && !util.isBoolean(isOnce)) {
            throw new TypeError('invalid isOnce argument');
        }

        if (event === 'ready') {

            // ready event already triggered
            if (this.ready) {
                let self = this;
                setTimeout(function () {
                    handler.call(self);
                }, 1);
                return;
            }

            // otherwise 'ready' handlers are converted to one-time handler
            isOnce = true;
        }



        // Create a list of event handlers for the event if one does not exist
        if (this[eventListenersKey][event] == null) {
            this[eventListenersKey][event] = [];
        }

        // Store the handler
        this[eventListenersKey][event].push({
            handler: handler,
            once: isOnce == null ? false : isOnce
        });

        // Return instance to enable chaining
        return this;
    }

    off(event, handler, isOnce) {

        // validate event
        if (!util.isString(event, {notEmpty: true})) {
            throw new TypeError('invalid name argument');
        }

        // validate handler
        if (!util.isCallable(handler)) {
            throw new TypeError('invalid handler argument');
        }

        // validate isOneTimeHandler
        if (isOnce != null && !util.isBoolean(isOnce)) {
            throw new TypeError('invalid isOneTimeHandler argument');
        }

        let listeners = self[eventListenersKey][event];

        // event does not have registered listeners so nothing left to do
        if (listeners == null || !listeners.length) {
            return;
        }

        // ready event handler should be one-time event handlers
        if (event === 'ready') {
            isOnce = true;
        }

        // find
        let idx = listeners.length;
        do {
            idx -= 1;

            // get listener instance
            let listener = listeners[idx];

            // Check: listener instance matches the inputs
            if (listener.handler === handler && listener.once === isOnce) {

                // remove the listener and exit looping
                listeners.splice(idx, 1);
                break;
            }
        } while (idx > 0);

        // Return instance to enable chaining
        return this;
    }

    once(event, handler) {
        return this.on(event, handler, true);
    }

    nonce(event, handler) {
        return this.off(event, handler, true);
    }

    emit(event, data, options) {

        // Validate inputs
        if (!util.isString(event, {notEmpty: true})) {
            throw new TypeError('invalid event name');
        }

        // Add emitter to processing queue
        this[eventEmitQueueKey].push({
            name: event,
            data: data,
            options: options == null ? {} : options
        });

        // Event processor not running so start it
        if (this[eventEmitTimeoutKey] == null) {
            this[eventEmitTimeoutKey] = setTimeout(processEmitQueue, 1, this);
        }

        // return instance to enable chaining
        return this;
    }
}

module.exports = Emitter;
},{"./util.js":4}],4:[function(require,module,exports){
'use strict';

const hasOwnProperty = Object.prototype.hasOwnProperty;

function isBoolean(subject) {
    return subject === true || subject === false;
}
function isNumber(subject, opts = {}) {

    // not a primitive number
    if (typeof subject !== 'number' || Number(subject) !== subject) {
        return false;
    }

    // nan not allowed
    if (!opts.allowNaN && isNaN(subject)) {
        return false;
    }

    // infinity not allowed
    if (!opts.allowInfinity && !isFinite(subject)) {
        return false;
    }

    // above specified min
    if (opts.min && subject < opts.min) {
        return false;
    }

    // above specified max
    if (opts.max && subject > opts.max) {
        return false;
    }

    // not a whole number
    if (opts.whole && subject % 1 > 0) {
        return false;
    }

    // is valid
    return true;
}
function isString(subject, opts = {}) {

    // not a primitive string
    if (typeof subject !== 'string' || String(subject) !== subject) {
        return false;
    }

    // Empty string not allowed
    if (opts.notEmpty && subject === '') {
        return false;
    }

    // string didn't match specified regex
    if (opts.match && !opts.match.test(subject)) {
        return false;
    }

    return true;
}
function isBase64(subject, options = {}) {

    // Is either not a string or an empty string
    if (!isString(subject, {notEmpty: true})) {
        return false;
    }

    let char62 = options['62'] != null ? options['62'] : '+',
        char63 = options['63'] != null ? options['63'] : '/';

    // validate 62nd and then escape it for the regex pattern
    if (!isString(char62, {notEmpty: true, matches: /^[+._~-]$/i})) {
        throw new TypeError('specified 62nd character invalid');
    }

    // validate 62nd and then escape it for the regex pattern
    if (!isString(char63, {notEmpty: true, matches: /^[^/_,:-]$/i})) {
        throw new TypeError('specified 63rd character invalid');
    }

    // validate 62nd and 63rd pairing
    switch (char62 + char63) {
    case '+/': // RFC 1421, 2045, 3548, 4880, 1642
    case '+,': // RFC 3501
    case '._': // YUI, Program identifier variant 2
    case '.-': // XML name tokens
    case '_:': // RFC 4648
    case '_-': // XML identifiers, Program Identifier variant 1
    case '~-': // Freenet URL-safe
    case '-_': // RFC 4648
        break;
    default:
        throw new TypeError('invalid 62nd and 63rd character pair');
    }

    // escape for regex
    char62 = '\\' + char62;
    char63 = '\\' + char63;

    // create regex
    let match = new RegExp(`^(?:[a-z\\d${char62}${char63}]{4})*(?:[a-z\\d${char62}${char63}]{2}(?:[a-z\\d${char62}${char63}]|=)=)?$`, 'i');

    // test the input
    return match.test(subject);
}

function isArray(subject) {
    return Array.isArray(subject) && subject instanceof Array;
}

function isKey(subject, key) {
    return hasOwnProperty.call(subject, key);
}

const isCallable = (function() {

    // https://github.com/ljharb/is-callable
    let fnToStr = Function.prototype.toString,
        fnClass = '[object Function]',
        toStr = Object.prototype.toString,
        genClass = '[object GeneratorFunction]',
        hasToStringTag = typeof Symbol === 'function' && typeof Symbol.toStringTag === 'symbol',
        constructorRegex = /^\s*class\b/;

    function isES6ClassFn(value) {
        try {
            let fnStr = fnToStr.call(value);
            return constructorRegex.test(fnStr);
        } catch (e) {
            return false; // not a function
        }
    }

    function tryFunctionObject(value) {
        try {
            if (isES6ClassFn(value)) {
                return false;
            }
            fnToStr.call(value);
            return true;
        } catch (e) {
            return false;
        }
    }
    return function isCallable(value) {
        if (!value) {
            return false;
        }
        if (typeof value !== 'function' && typeof value !== 'object') {
            return false;
        }
        if (typeof value === 'function' && !value.prototype) {
            return true;
        }
        if (hasToStringTag) {
            return tryFunctionObject(value);
        }
        if (isES6ClassFn(value)) {
            return false;
        }
        let strClass = toStr.call(value);
        return strClass === fnClass || strClass === genClass;
    };
}());

const deepFreeze = (function() {
    function freeze(obj, freezing) {

        // Loop over properties of the input object
        // Done before freezing the initial object
        Object.keys(obj).forEach(key => {

            // ignore properties that have setter/getter descriptors
            let desc = Object.getOwnPropertyDescriptor(obj, key);
            if (!isKey(desc, 'value')) {
                return;
            }

            // get property's value
            let value = obj[key];

            if (
            // value isn't null or undefined
                value != null &&

            // value isn't frozen
            !Object.isFrozen(value) &&

            // value is freezable
            value instanceof Object &&

            // value isn't already in the process of being frozen
            freezing.findIndex(item => item === value) === -1
            ) {

                // store a reference to the value - used to prevent circular reference loops
                freezing.push(value);

                // freeze the property
                obj[key] = freeze(value, freezing);

                // remove the reference
                freezing.pop(value);
            }
        });

        // freeze the base object
        return Object.freeze(obj);
    }
    return function deepFreeze(subject) {
        return freeze(subject, [subject]);
    };
}());

module.exports = Object.freeze({
    isBoolean: isBoolean,
    isNumber: isNumber,
    isString: isString,
    isBase64: isBase64,
    isArray: isArray,
    isKey: isKey,
    isCallable: isCallable,
    deepFreeze: deepFreeze
});
},{}],5:[function(require,module,exports){
const Emitter = require('../misc/emitter.js');

function cleanup(self) {
    self.connection.onopen =
        self.connection.onmessage =
        self.connection.onclose =
        self.connection.onerror = null;

    self.connection = null;
    self.readyState = 0;
}
function reconnect(self) {
    self.readyState = 1;

    self.reconnectTimeout = setTimeout(function () {
        self.connect(self.port, self.uuid, self.register);
    }, self.delay);

    self.delay *= 1.5;
    if (self.delay > 30000) {
        self.delay = 30000;
    }
}
function onOpen() {
    this.readyState = 2;
    this.connection.send(JSON.stringify({
        event: this.register,
        uuid: this.uuid
    }));
    this.delay = 1000;
    this.readyState = 3;
    this.emit('connect');

    if (this.spooled.length) {
        this.spooled.forEach(msg => this.connection.send(msg));
        this.spooled = [];
    }
}
function onMessage(evt) {
    this.emit('message', evt.data);
}
function onError() {
    cleanup(this);

    this.emit('error');

    reconnect(this);
}
function onClose(evt) {

    // cleanup connection
    cleanup(this);

    // deduce close reason and emit event
    let reason;
    switch (evt.code) {
    case 1000:
        reason = 'Normal Closure. The purpose for which the connection was established has been fulfilled.';
        break;
    case 1001:
        reason = 'Going Away. An endpoint is "going away", such as a server going down or a browser having navigated away from a page.';
        break;
    case 1002:
        reason = 'Protocol error. An endpoint is terminating the connection due to a protocol error';
        break;
    case 1003:
        reason = "Unsupported Data. An endpoint received a type of data it doesn't support.";
        break;
    case 1004:
        reason = '--Reserved--. The specific meaning might be defined in the future.';
        break;
    case 1005:
        reason = 'No Status. No status code was actually present.';
        break;
    case 1006:
        reason = 'Abnormal Closure. The connection was closed abnormally, e.g., without sending or receiving a Close control frame';
        break;
    case 1007:
        reason = 'Invalid frame payload data. The connection was closed, because the received data was not consistent with the type of the message (e.g., non-UTF-8 [http://tools.ietf.org/html/rfc3629]).';
        break;
    case 1008:
        reason = 'Policy Violation. The connection was closed, because current message data "violates its policy". This reason is given either if there is no other suitable reason, or if there is a need to hide specific details about the policy.';
        break;
    case 1009:
        reason = 'Message Too Big. Connection closed because the message is too big for it to process.';
        break;
    case 1010:
        // Note that this status code is not used by the server, because it can fail the WebSocket handshake instead.
        reason = "Mandatory Ext. Connection is terminated the connection because the server didn't negotiate one or more extensions in the WebSocket handshake. Mandatory extensions were: " + evt.reason;
        break;
    case 1011:
        reason = 'Internl Server Error. Connection closed because it encountered an unexpected condition that prevented it from fulfilling the request.';
        break;
    case 1015:
        reason = "TLS Handshake. The connection was closed due to a failure to perform a TLS handshake (e.g., the server certificate can't be verified).";
        break;
    default:
        reason = 'Unknown reason';
        break;
    }

    // emit close event
    this.emit(`close`, {code: evt.code, reason: reason});

    // attempt reconnection
    reconnect();
}

class Connection extends Emitter {
    constructor() {
        super();
        this.readyState = 0;
        this.reconnectDelay = 1000;
        this.reconnectDecay = 1.1;
        this.spooled = [];
        this.delay = 1000;
    }
    connect(port, uuid, register) {
        if (this.connection) {
            return;
        }
        this.port = port;
        this.uuid = uuid;
        this.register = register;
        this.readyState = 1;

        this.connection = new WebSocket(`ws://localhost:${port}`);
        this.connection.onopen    = onOpen.bind(this);
        this.connection.onmessage = onMessage.bind(this);
        this.connection.onerror   = onError.bind(this);
        this.connection.onclose   = onClose.bind(this);
    }
    send(data) {
        if (this.readyState === 3 && !this.spooled.length) {
            this.connection.send(data);
        } else {
            this.spooled.push(data);
        }
    }
    sendJSON(data) {
        this.send(JSON.stringify(data));
    }
    close() {
        if (this.connection) {
            this.connection.close();
            cleanup(this);
        }
    }
}

module.exports = Connection;
},{"../misc/emitter.js":3}],6:[function(require,module,exports){
const util = require('../misc/util.js');

function validateTarget(target) {
    target = target == null ? 0 : target;

    if (String(target) === target) {
        target = target.toLowerCase();
    }

    switch (target) {
    case 0:
    case 'both':
        return 0;

    case 1:
    case 'hardware':
        return 1;

    case 2:
    case 'software':
        return 2;

    default:
        throw new TypeError('invalid target argument');
    }
}

class Context {
    constructor(streamdeck, action, uuid) {
        this.streamdeck = streamdeck;

        // todo: validate action and uuid
        this.action = action;
        this.uuid   = uuid;
    }

    setTitle(title, target) {
        if (title != null && !util.isString(title)) {
            throw new TypeError('invalid title argument');
        }

        let payload = {target: validateTarget(target)};
        if (title != null) {
            payload.title = title;
        }
        this.streamdeck.sendJSON({
            event: "setTitle",
            context: this.uuid,
            payload: payload
        });
    }

    setImage(image, target) {
        // todo: validate image

        let payload = {target: validateTarget(target)};
        if (image != null) {
            payload.image = image;
        }
        this.streamdeck.sendJSON({
            event: "setImage",
            context: this.uuid,
            payload: payload
        });
    }

    setImageFromUrl(url, target) {
        if (!util.isString(url, {notEmpty: true})) {
            throw new TypeError('invalid url');
        }

        target = validateTarget(target);

        let self = this,
            image = new Image();

        image.onload = function () {

            // create canvas
            let canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;

            // draw image on canvas
            let ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0);

            // convert canvas to png data url and use .setImage
            self.setImage(canvas.toDataURL("image/png"), target);
        };
        image.onerror = function () {
            image.onerror = null;
            image.onload = null;
            image = null;
            console.error('[context#setImageFromUrl] failed to load image:', url);
        };
        image.src = url;
    }

    showAlert() {
        this.streamdeck.sendJSON({
            event: "showAlert",
            context: this.uuid
        });
    }

    showOk() {
        this.streamdeck.sendJSON({
            event: "showAlert",
            context: this.uuid
        });
    }

    setState(state) {
        if (!util.isNumber(state, {while: true, min: 0})) {
            throw new TypeError('invalid state argument');
        }

        this.streamdeck.sendJSON({
            event: "setState",
            context: this.uuid,
            payload: {state: state}
        });
    }

    send(data) {
        if (!util.isString(data)) {
            this.streamdeck.sendJSON({
                event: "sendToPropertyInspector",
                action: this.action,
                context: this.uuid,
                payload: data
            });
        }
    }

    setSettings(data) {
        this.streamdeck.sendJSON({
            event: "setSettings",
            context: this.uuid,
            payload: data
        });
    }

    toSafe() {

        // TODO: Create an externally-safe clone of the context instance
        return this;
    }
}

module.exports = Context;
},{"../misc/util.js":4}],7:[function(require,module,exports){
const util = require('../misc/util.js');
const Context = require('./context.js');

module.exports = function (streamdeck, $devices, $contexts) {

    return function onmessage(evt) {
        let msg = evt.data;

        // Streamdeck doesn't send empty messages
        if (msg == null) {
            return;
        }

        // Streamdeck always sends JSON objects
        //   msg doesn't appear to be a json object string
        if (!util.isString(msg, {match: /^\{[\s\S]+\}$/})) {
            console.log('[onmessage] message doesn\'t appear to be JSON');
            return;
        }
        try {
            msg = JSON.parse(msg);

        // parse failed, return indicating not a streamdeck message
        } catch (e) {
            console.log('[onmessage] message failed to parse');
            return;
        }

        // Streamdeck messages always have an event property that is a non-empty string
        if (!util.isString(msg.event, {notEmpty: true})) {
            console.log('[onmessage] message doesn\'t have an event property');
            return;
        }


        // PropertyInspector Layer Events
        if (streamdeck.layer === 'propertyinspector') {

            // Temporary - Instead, process as RPC message
            if (msg.event === 'sendToPropertyInspector') {
                streamdeck.emit('streamdeck:messagerelay', {message: msg.payload});

            // Unknown evnt
            } else {
                console.log('[onmessage#propertyinspector] unknow property-inspector layer event:', msg.event);
                return;
            }

        // Event: applicationDidLaunch
        // Event: applicationDidTerminate
        } else if (msg.event === 'applicationDidLaunch' || msg.event === 'applicationDidTerminate') {

            // validate payload
            if (msg.payload == null || !util.isString(msg.payload.application, {notEmpty: true})) {
                console.log('[onmessage#plugin] Bad applicationDidLaunch/terminate event', msg);
                return;
            }

            // Emit events
            let appEvent = msg.event === 'applicationDidLaunch' ? 'launch' : 'terminate';
            streamdeck.emit(`streamdeck:application:${appEvent}`, msg.payload.application);
            streamdeck.emit(`streamdeck:application`, {event: appEvent, application: msg.payload.application});


        // Event: deviceDidConnect
        // Event: deviceDidDisconnect
        } else if (msg.event === 'deviceDidConnect' || msg.event === 'deviceDidDisconnect') {

            // Validate device data
            if (
                !util.isString(msg.device, {notEmpty: true}) ||
                msg.deviceInfo.size == null ||
                msg.deviceInfo.size.columns == null ||
                msg.deviceInfo.size.rows == null ||
                !util.isNumber(msg.deviceInfo.type, {whole: true, min: 0}) ||
                !util.isNumber(msg.deviceInfo.size.columns, {whole: true, min: 0}) ||
                !util.isNumber(msg.deviceInfo.size.rows, {whole: true, min: 0})
            ) {
                console.log('[onmessage#plugin] Bad deviceDidConnect/disconnect event', msg);
                return;
            }

            // Build device info object
            let devInfo = {
                    id: msg.device,
                    type: msg.deviceInfo.type,
                    columns: msg.deviceInfo.size.rows,
                    rows: msg.deviceInfo.size.rows
                },
                devEvent = msg.event === 'deviceDidConnect' ? 'connect' : 'disconnect';

            // device connected: store the info in streamdeck's device list
            if (devEvent === 'connect') {
                $devices[devInfo.id] = Object.assign(Object.create(null), devInfo);

            // device diconnected: remove the device from streamdeck's device list
            } else if ($devices[devInfo.id] != null) {
                delete $devices[devInfo.id];
            }

            // Emit events
            streamdeck.emit(`streamdeck:device:${devEvent}`, devInfo);
            streamdeck.emit('streamdeck:device', {event: devEvent, device: devInfo});

        // msg.context should be a hex string
        } else if (!util.isString(msg.context, {match: /^[A-F\d]{32}$/})) {
            console.log('[onmessage#plugin] Bad context property:', msg);
            return;

        // msg.action should be a reversed dns formatted string
        } else if (!util.isString(msg.action, {match: /^[^\\/;%@:]+$/})) {
            console.log('[onmessage#plugin] Bad action property:', msg);
            return;

        // msg.pay should be non-null
        } else if (msg.payload == null) {
            console.log('[onmessage#plugin] Missing payload:', msg);
            return;

        } else {

            // Retrieve any stored information about the device
            let device;
            if ($devices[msg.device] != null) {
                device = Object.assign(Object.create(null), $devices[msg.device]);
            } else {
                device = {id: msg.device};
            }

            // Retrieve and update context
            let evtContext;
            if ($contexts[msg.context] != null) {
                evtContext = $contexts[msg.context];
            } else {
                evtContext = new Context(streamdeck, msg.action, msg.context);
            }
            evtContext.action = msg.action;


            // Event: sendToPlugin
            // Temporary - Instead, process as RPC message
            if (msg.event === 'sendToPlugin') {
                streamdeck.emit('streamdeck:messagerelay', {
                    context: evtContext.toSafe(),
                    message: msg.payload
                });

            // msg.payload.settings should be an object
            } else if (msg.payload.settings == null) {
                console.log('[onmessage#plugin] Missing payload.settings:', msg);
                return;

            // if specified, msg.payload.state should be an unsigned integer
            } else if (msg.payload.state != null && !util.isNumber(msg.payload.state, {whole: true, min: 0})) {
                console.log('[onmessage#plugin] invalid payload.state:', msg);
                return;

            // if specified, msg.payload.isInMultiAction should be a boolean value
            } else if (msg.payload.isInMultiAction != null && !util.isBoolean(msg.payload.isInMultiAction)) {
                console.log('[onmessage#plugin] Missing payload.isInMultiAction:', msg);
                return;

            // msg.payload.coordinates should be an object
            } else if (msg.payload.coordinates == null) {
                console.log('[onmessage#plugin] Missing payload.coordinates:', msg);
                return;

            // msg.payload.coordinates.column should be an unsigned integer
            } else if (!util.isNumber(msg.payload.coordinates.column, {whole: true, min: 0})) {
                console.log('[onmessage#plugin] invalid payload.coordinates.column:', msg);
                return;

            // msg.payload.coordinates.column should be an unsigned integer
            } else if (!util.isNumber(msg.payload.coordinates.row, {whole: true, min: 0})) {
                console.log('[onmessage#plugin] invalid payload.coordinates.row', msg);
                return;

            // Checks passed!
            } else {

                // Update context state
                evtContext.column   = msg.payload.coordinates.column;
                evtContext.row      = msg.payload.coordinates.row;
                evtContext.device   = device;
                if (msg.payload.settings != null) {
                    evtContext.settings = msg.payload.settings;
                }
                if (msg.payload.isInMultiAction != null) {
                    evtContext.inMultiAction = msg.payload.isInMultiAction;
                }
                if (msg.payload.state != null) {
                    evtContext.state = msg.payload.state;
                }

                // Event: keyUp
                // Event: keyDown
                if (msg.event === 'keyUp' || msg.event === 'keyDown') {

                    // emit events
                    let keyEvent = msg.event === 'keyUp' ? 'up' : 'down';
                    streamdeck.emit(`streamdeck:keypress:${keyEvent}`, {context: evtContext.toSafe(), device: Object.assign(Object.create(null), device)});
                    streamdeck.emit(`streamdeck:keypress`, {event: keyEvent, context: evtContext.toSafe(), device: Object.assign(Object.create(null), device)});

                // Event: willAppear
                // Event: willDisappear
                } else if (msg.event === 'willAppear' || msg.event === 'willDisappear') {
                    let disEvent = msg.event === 'willAppear' ? 'appear' : 'disappear';

                    // if appearing, add the context to the tracked contexts list
                    if (disEvent === 'appear') {
                        $contexts[evtContext.uuid] = evtContext;

                    // otherwise remove it from the tracked contexts list
                    } else if ($contexts[evtContext.uuid] != null) {
                        delete $contexts[evtContext.uuid];
                    }

                    // emit events
                    streamdeck.emit(`streamdeck:button:${disEvent}`, evtContext.toSafe());
                    streamdeck.emit('streamdeck:button', {event: disEvent, context: evtContext.toSafe()});

                // Event: titleParametersDidChange
                } else if (msg.event === 'titleParametersDidChange') {

                    let params = msg.payload.titleParameters;
                    if (
                        !util.isString(msg.payload.title) ||
                        params == null ||
                        !util.isString(params.fontFamily) ||
                        !util.isNumber(params.fontSize, {whole: true, min: 6}) ||
                        !util.isString(params.fontStyle) ||
                        !util.isBoolean(params.fontUnderline) ||
                        !util.isBoolean(params.showTitle) ||
                        !util.isString(params.titleAlignment, {match: /^(?:top|middle|bottom)$/}) ||
                        !util.isString(params.titleColor, {match: /^#(?:[a-f\d]{1,8})$/})
                    ) {
                        console.log('[onmessage#plugin] invalid title payload', msg.title, params);
                        return;
                    }

                    let previousTitle = evtContext.title;
                    evtContext.title = {
                        text:      msg.payload.title,
                        font:      params.fontFamily,
                        style:     params.fontStyle,
                        underline: params.fontUnderline,
                        shown:     params.showTitle,
                        alignment: params.titleAlignment,
                        color:     params.titleColor
                    };
                    streamdeck.emit('streamdeck:button:titlechange', {
                        context: evtContext.toSafe(),
                        previousTitle: previousTitle
                    });
                    streamdeck.emit('streamdeck:button', {
                        event: 'titlechange',
                        context: evtContext.toSafe(),
                        previousTitle: previousTitle
                    });

                    // unknown event
                } else {
                    console.log('[onmessage] unknown event', msg);
                    return;
                }
            }
        }
        evt.stop();
    };
};
},{"../misc/util.js":4,"./context.js":6}],8:[function(require,module,exports){
const util = require('../misc/util.js');
const Context = require('./context.js');

const idChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function makeResult(id, state, data) {
    return {
        rpc: {
            id: id,
            type: 'reply',
            state: state,
            data: data == null ? null : data
        }
    };
}


module.exports = function rpc(streamdeck) {

    let $pending = {},
        $methods = {};


    function generateId() {
        let result = "";
        do {
            let i = 32;
            while (i) {
                i -= 1;
                result += idChars[Math.floor(Math.random() * idChars.length)];
            }
        } while (util.isKey($pending, result) && $pending[result] != null);
        return result;
    }

    Object.defineProperties(streamdeck, {
        register: {
            enumerable: true,
            value: function register(method, handler) {
                if (!util.isString(method, {notEmpty: true})) {
                    throw new TypeError('invalid method argument');
                }
                if (!util.isCallable(handler)) {
                    throw new TypeError('invalid handler argument');
                }
                if (util.isKey($methods, method) && $methods[method] != null) {
                    throw new TypeError('method already registered');
                }
                $methods[method] = handler;
            }
        },
        unregister: {
            enumerable: true,
            value: function unregister(method, handler) {
                if (!util.isString(method, {notEmpty: true})) {
                    throw new TypeError('invalid method argument');
                }
                if (!util.isKey($methods, method) || $methods[method] == null) {
                    return;
                }
                if (!util.isCallable(handler)) {
                    throw new TypeError('invalid handler argument');
                }
                if ($methods[method] !== handler) {
                    throw new TypeError('handler does not match registered handler');
                }

                delete $methods[method];
            }
        }
    });

    Object.defineProperties(Context.prototype, {
        invoke: {
            enumerable: true,
            value: function invoke(method, ...args) {
                let id = generateId();

                let invokePromise = new Promise((resolve, reject) => {
                    $pending[id] = {resolve: resolve, reject: reject};
                });

                $pending[id].timeout = setTimeout(function () {
                    let reject = $pending[id].reject;
                    delete $pending[id];

                    reject(new Error('invocation timed out'));
                }, 30000);

                this.send({
                    rpc: {
                        type:   "invoke",
                        method: method,
                        data:   args,
                        id:     id
                    }
                });

                return invokePromise;
            }
        },
        notify: {
            enumerable: true,
            value: function notify(event, data) {
                this.send({
                    rpc: {
                        type:  "notify",
                        event: event,
                        data:  data || {},
                        id:    "0"
                    }
                });
            }
        }
    });


    streamdeck.on('ready', function () {

        if (streamdeck.layer === 'propertyinspector') {
            Object.defineProperties(streamdeck, {
                invoke: {
                    enumerable: true,
                    value: function invoke(method, ...args) {

                        let id = generateId();

                        let invokePromise = new Promise((resolve, reject) => {
                            $pending[id] = {resolve: resolve, reject: reject};
                        });

                        $pending[id].timeout = setTimeout(function () {
                            let reject = $pending[id].reject;
                            delete $pending[id];

                            reject(new Error('invocation timed out'));
                        }, 30000);


                        streamdeck.sendToPlugin({
                            rpc: {
                                type:   "invoke",
                                method: method,
                                data:   args,
                                id:     id
                            }
                        });

                        return invokePromise;
                    }
                },
                notify: {
                    enumerable: true,
                    value: function notify(event, data) {
                        streamdeck.sendToPlugin({
                            rpc: {
                                type: 'notify',
                                event: event,
                                data:  data || {},
                                id:    "0"
                            }
                        });
                    }
                }
            });
        }
    });
    streamdeck.on('streamdeck:messagerelay', function (evt) {

        let context = evt.data.context,
            data = evt.data.message;

        // basic validation
        if (
            data == null ||
            data.rpc == null ||
            !util.isString(data.rpc.type, {match: /^(?:invoke|reply|notify)$/}) ||
            !util.isString(data.rpc.id, {notEmpty: true})
        ) {
            return;
        }

        let rpc = evt.data.message.rpc;

        if (rpc.type === 'notify') {

            /*{
                id:    "0",
                type:  "notify",
                event: "...",
                data:  ...
            }*/

            if (rpc.id !== "0" || !util.isString(rpc.event, {notEmpty: true})) {
                return;
            }

            if (streamdeck.layer === 'plugin') {
                streamdeck.emit(`streamdeck:notify:${rpc.event}`, {context: context, data: rpc.data});

            } else {
                streamdeck.emit(`streamdeck:notify:${rpc.event}`, rpc.data);
            }

        } else if (!util.isString(rpc.id, {match: /^(?:[a-z\d]{32})$/i})) {
            return;


        } else if (rpc.type === 'reply') {

            /*{
                id:     "...",
                type:   "reply",
                state:  "ok"|"error",
                data:   ...|'error message'
            }*/

            if (rpc.state !== 'ok' && rpc.state !== 'error') {
                return;
            }
            if (!util.isKey($pending, rpc.id) || $pending[rpc.id] == null) {
                return;
            }

            let invokePromise = $pending[rpc.id],
                resolve = invokePromise.resolve,
                reject = invokePromise.reject;

            clearTimeout(invokePromise.timeout);
            delete $pending[rpc.id];

            if (rpc.state === 'ok') {
                resolve(rpc.data);

            } else {
                reject(new Error(rpc.data));
            }

        } else if (rpc.type === 'invoke') {

            /*{
                id:     "...",
                type:   "invoke",
                method: "...",
                data:   ...
            }*/

            if (!util.isString(rpc.method, {notEmpty: true})) {
                return;
            }

            if (!util.isKey($methods, rpc.method) || $methods[rpc.method] == null) {
                let result = makeResult(rpc.id, 'error', 'method not registered');
                if (streamdeck.layer === 'plugin') {
                    context.send(result);

                } else {
                    streamdeck.sendToPlugin(result);
                }

            } else {

                let args = rpc.data == null ? [] : rpc.data;
                if (!util.isArray(args)) {
                    args = [args];
                }

                try {
                    let methodResult;
                    if (streamdeck.layer === 'plugin') {
                        methodResult = $methods[rpc.method].call(streamdeck, context, ...args);
                    } else {
                        methodResult = $methods[rpc.method].call(streamdeck, ...args);
                    }

                    if (!(methodResult instanceof Promise)) {
                        methodResult = Promise.resolve(methodResult);
                    }

                    methodResult
                        .then(
                            res => {
                                let result = makeResult(rpc.id, 'ok', res);


                                if (streamdeck.layer === 'plugin') {
                                    context.send(result);
                                } else {
                                    streamdeck.sendToPlugin(result);
                                }
                            },
                            err => {
                                let result = makeResult(rpc.id, 'error', err instanceof Error ? err.message : String(err) === err ? err : 'unknown error');

                                if (streamdeck.layer === 'plugin') {
                                    context.send(result);
                                } else {
                                    streamdeck.sendToPlugin(result);
                                }
                            }
                        )
                        .catch(err => {
                            let result = makeResult(rpc.id, 'error', err instanceof Error ? err.message : String(err) === err ? err : 'unknown error');
                            if (streamdeck.layer === 'plugin') {
                                context.send(result);
                            } else {
                                streamdeck.sendToPlugin(result);
                            }
                        });
                } catch (err) {
                    let result = makeResult(rpc.id, 'error', err.message);
                    if (streamdeck.layer === 'plugin') {
                        context.send(result);
                    } else {
                        streamdeck.sendToPlugin(result);
                    }
                }
            }

        } else {
            return;
        }

        evt.stop();
    });
};
},{"../misc/util.js":4,"./context.js":6}]},{},[1]);
