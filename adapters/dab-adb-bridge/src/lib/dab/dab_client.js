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

import  * as topics  from './dab_topics.js';

export class DabClient {
    /**
     Sample DAB client based on the DabMqttClient implementation

     */
    constructor(dab_mqtt_client) {
        /** @private @const  */
        this.client = dab_mqtt_client;
    }

    async showMessages() {
        this.messagesSub = await this.client.subscribe(
            topics.DAB_MESSAGES, async (message) => {
                console.log(`DAB message: ${JSON.stringify(message)}\n`);
            }
        );
    }

    async hideMessages() {
        if (this.messagesSub) await this.messagesSub.end();
    }

    async showDeviceTelemetry() {
        this.deviceTelemetrySub = await this.client.subscribe(
            topics.TELEMETRY_METRICS_TOPIC, async (message) => {
                console.log(`Device telemetry: ${JSON.stringify(message, null, 2)}\n`);
            }
        );
    }

    async hideDeviceTelemetry() {
        if (this.deviceTelemetrySub) await this.deviceTelemetrySub.end();
    }

    async showAppTelemetry() {
        this.appTelemetrySub = await this.client.subscribe(
            `topics.TELEMETRY_METRICS_TOPIC/+`, async (message) => {
                console.log(`App telemetry: ${JSON.stringify(message, null, 2)}\n`);
            }
        );
    }

    async hideAppTelemetry() {
        if (this.appTelemetrySub) await this.appTelemetrySub.end();
    }

    async version() {
        return await this.client.subscribeOnce(topics.DAB_VERSION_TOPIC);
    }

    async deviceInfo() {
        return await this.client.subscribeOnce(topics.DEVICE_INFO_TOPIC);
    }

    async listApps() {
        return await this.client.request(
            topics.APPLICATIONS_LIST_TOPIC
        )
    }

    async exitApp(app, force=false) {
        return await this.client.request(
            topics.APPLICATIONS_EXIT_TOPIC,
            {
                app: app,
                force: force
            }
        )
    }

    async launchApp(app, parameters) {
        return await this.client.request(
            topics.APPLICATIONS_LAUNCH_TOPIC,
            {
                app: app,
                parameters: parameters
            }
        )
    }

    async pressKey(keyCode){
        return await this.client.request(
            topics.INPUT_KEY_PRESS_TOPIC,
            {
                keyCode: keyCode
            }
        )
    }

    async pressKeyLong(keyCode, durationMs){
        return await this.client.request(
            topics.INPUT_LONG_KEY_PRESS_TOPIC,
            {
                keyCode: keyCode,
                durationMs: durationMs
            }
        )
    }

    async startDeviceTelemetry(frequency){
        return await this.client.request(
            topics.DEVICE_TELEMETRY_START_TOPIC,
            {
                frequency: frequency
            }
        )
    }

    async stopDeviceTelemetry(){
        return await this.client.request(
            topics.DEVICE_TELEMETRY_STOP_TOPIC
        )
    }

    async startAppTelemetry(appId, frequency){
        return await this.client.request(
            topics.APP_TELEMETRY_START_TOPIC,
            {
                app: appId,
                frequency: frequency
            }
        )
    }

    async stopAppTelemetry(appId){
        return await this.client.request(
            topics.APP_TELEMETRY_STOP_TOPIC,
            {
                app: appId
            }
        )
    }

    async restart(){
        return await this.client.request(
            topics.SYSTEM_RESTART_TOPIC
        )
    }

    async healthCheck(){
        return await this.client.request(
            topics.HEALTH_CHECK_TOPIC
        )
    }
}
