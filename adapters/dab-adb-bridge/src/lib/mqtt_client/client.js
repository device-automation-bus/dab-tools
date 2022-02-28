/**
 Copyright 2019 Amazon.com, Inc. or its affiliates.
 Copyright 2019 Netflix Inc.
 Copyright 2019 Google LLC
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import mqtt from 'async-mqtt';
import { serializeError } from 'serialize-error';
import { v4 as uuidv4 } from 'uuid';
import { TimeoutError } from './error.js';
import { convertPattern } from './util.js';
import ee2pkg from 'eventemitter2';
const { EventEmitter2 } = ee2pkg;

/**
 * @typedef {Object} Message
 * @property {string} [error]
 */

/**
 * @callback SubscriptionCallback
 * @param {Message} message
 * @param {MqttPacket} packet
 */

/**
 * @typedef {string|Buffer} MqttPayload
 */

/**
 * @typedef {Object} MqttPacket
 * @property {string} [topic]
 * @property {MqttPayload} payload
 */

/**
 * @typedef {Object} MqttOptions
 * @property {number} timeoutMs
 * @property {number} qos
 */

/**
 * @typedef {Object} Subscription
 * @property {Function} end ends a subscription
 */

/**
 * @class
 * @private
 */
class Client {

    #client;
    #emitter;
    #handlerSubscriptions;

  /**
   *  A generic construct that takes in an async mqtt client.
   * @param {MqttClient} mqttClient
   */
  constructor(mqttClient) {
    this.#client = mqttClient;
    this.#emitter = new EventEmitter2({
      wildcard: true,
      delimiter: "/",
      verboseMemoryLeak: true,
    });

    this.#handlerSubscriptions = [];

    this.#client.setOnMessage(this.#handleMessage.bind(this));
  }

  /**
   * Callback when the client receives a message to one of the subscribed topics
   * - the message could be a response from the client / device to the previous request
   * - the message could be a request to the client / device
   * @private
   * @param  {string} topic
   * @param  {MqttPayload} [msg]
   * @param  {MqttPacket} pkt
   */
  #handleMessage(topic, msg, pkt) {
    let response = {};

    if (msg && msg.length) {
      try {
        response = JSON.parse(msg.toString());
      } catch (error) {
        response = {
          status: 500,
          error: "failed to parse msg",
          msg: msg.toString(),
          packet: pkt
        };
      }
    }
    this.#emitter.emit(topic, response, pkt);
  }

  /**
   * @param  {string} topic
   * @param  {Object} msg
   * @param  {MqttOptions} options
   */
  async publish(topic, msg, options = {}) {
    const defaultOptions = { qos: 2, retain: false };
    options = Object.assign(defaultOptions, options);

    return this.#client.publish(topic, msg, options);
  }

  /**
   * @param  {string} topic
   * @param  {SubscriptionCallback} callback
   */
  subscribe(topic, callback) {
    const event = convertPattern(topic);
    this.#emitter.on(event, callback);
    this.#client.subscribe(topic);

    return {
      end: () => {
        this.#emitter.removeListener(event, callback);
        if (this.#emitter.listeners(event).length === 0) {
          this.#client.unsubscribe(topic);
        }
      },
    };
  }

  /**
   * Makes a request to the DAB-enabled device, using the request/response convention
   * This method will automatically generate the request ID and append it to the request
   * If operation timed-out, it will throw a error.
   * @param  {string} topic
   * @param  {Object} payload
   * @param  {MqttOptions} options
   */
  async request(topic, payload = {}, options = { qos: 2, timeoutMs: 5000 }) {
    const requestId = uuidv4();
    const requestTopic = `${topic}/${requestId}`;

    const timeout = options.timeoutMs || 5000;

    return new Promise((resolve, reject) => {
      let timer;
      const subscription = this.subscribe(`_response/${requestTopic}`, async function (msg) {
        subscription.end();
        clearTimeout(timer);

        if (msg.status > 299) {
          reject(msg);
        } else {
          resolve(msg);
        }
      });

      timer = setTimeout(async function () {
        subscription.end();
        reject(new TimeoutError(`Failed to receive response from ${topic} within ${timeout}ms`));
      }, timeout);

      this.publish(requestTopic, payload, options).catch(reject);
    });
  }

  /**
   * Handles topic response from broker.
   * @param  {string} topic
   * @param  {Function} handler
   */
  handle(topic, handler) {
    const subscription = this.subscribe(`${topic}/+`, async (msg, { topic: requestTopic }) => {
      if (!requestTopic) {
        return Promise.reject(
          new Error(`FATAL: Handler for topic (${topic}) failed to receive request topic.`)
        );
      } else {
        const responseTopic = `_response/${requestTopic}`;
        try {
          const resultMsg = await handler(
            msg,
            requestTopic.substring(0, requestTopic.lastIndexOf("/"))
          );
          return this.publish(responseTopic, resultMsg);
        } catch (error) {
          const status = error.status || 500;
          return this.publish(responseTopic, {
            status: status,
            error: JSON.stringify(serializeError(error)),
            request: msg
          });
        }
      }
    });

    this.#handlerSubscriptions.push(subscription);
  }

  async end(...args) {
    await Promise.all(this.#handlerSubscriptions.map((handler) => handler.end()));
    await this.#client.end(...args);
  }
}

/**
 * @private
 * @param {MqttClient} mqttClient
 */
function wrap(mqttClient) {
    return {
        setOnMessage: function (onMessage) {
            mqttClient.on("message", onMessage);
        },
        subscribe: function (topic) {
            return mqttClient.subscribe(topic);
        },
        unsubscribe: function (topic) {
            return mqttClient.unsubscribe(topic);
        },
        publish: function (topic, payload, options) {
            return mqttClient.publish(topic, JSON.stringify(payload), options);
        },
        end: function () {
            return mqttClient.end();
        }
    };
}

/**
 * Makes a mqtt connection and returns a async mqtt client.
 * @param  {string} uri mqtt connection uri
 * @param  {object} options mqtt connection options
 */
export function connect(uri, options = {}) {
    return new Promise((resolve, reject) => {
        const { keepAliveInterval = 10, ...otherOptions } = options;
        options = Object.assign(
            {
                keepalive: keepAliveInterval,
                connectTimeout: 2000,
                resubscribe: true,
                onConnected: () => {},
                onConnectionLost: () => {},
            },
            otherOptions
        );

        const mqttClient = mqtt.connect(uri, options);
        let connected = false;
        let initialized = false;

        const onError = (error) => {
            if (!connected && !initialized) {
                reject(error);
            }
            mqttClient.removeListener("error", onError);
        };

        mqttClient.on("error", onError);
        mqttClient.on("offline", options.onConnectionLost);
        mqttClient.on("connect", () => {
            if (!initialized) {
                connected = true;
                mqttClient.removeListener("error", onError);
                resolve(new Client(wrap(mqttClient)));
                options.onConnected();
            }

            initialized = true;
        });
    });
}
