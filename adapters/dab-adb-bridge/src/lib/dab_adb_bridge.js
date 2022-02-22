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

import config from 'config';
import { DabDeviceInterface } from './dab/dab_device_interface.js';
import { AdbCommands } from './adb/adb_commands.js';
import { getLogger } from "./util.js";
const logger = getLogger();

export class DabDevice extends DabDeviceInterface {

    constructor(deviceId){
        super();
        this.adb = new AdbCommands(deviceId);
        this.appMap = config.get("appMap");

    }

    deviceInfo = async () => {
        const deviceInfo = await this.adb.getDeviceDetails();

        return {
            manufacturer: deviceInfo.properties["ro.product.manufacturer"],
            model: deviceInfo.properties["ro.product.model"],
            serialNumber: deviceInfo.serial,
            chipset: deviceInfo.properties["ro.product.cpu.abi"],
            firmwareVersion: deviceInfo.properties["ro.build.fingerprint"],
            firmwareBuild: deviceInfo.properties["ro.build.fingerprint"],
            networkInterfaces: {
                connected: deviceInfo.networkType !== "other",
                macAddress: deviceInfo.mac,
                ipAddress: deviceInfo.ip,
                type: deviceInfo.networkType,
            },
            screenWidthPixels: deviceInfo.resolution.x,
            screenHeightPixels: deviceInfo.resolution.y,
            uptimeSeconds: await this.adb.getDeviceUptimeSeconds(),
            isRetail: undefined
        };
    }

    listApps = async () => {
        try {
            const appArr = [];
            const packageArr = await this.adb.getPackages();
            for (let appId of Object.keys(this.appMap)) {
                if (Array.isArray(this.appMap[appId])) {
                    for (const implObj of this.appMap[appId]) {
                        logger.debug(`Checking packages for appId: ${appId} with package ${implObj.package}`);
                        if (packageArr.includes(implObj.package)) {
                            this.appMap[appId] = implObj;
                            logger.debug("App found, pushing to appArr");
                            appArr.push({id: appId, friendlyName: this.appMap[appId].friendlyName, version: "unknown"});
                            break;
                        } else {
                            logger.debug("App not found, ignoring");
                        }
                    }
                } else {
                    logger.debug(`Checking packages for appId: ${appId} with package ${this.appMap[appId].package}`);
                    if (packageArr.includes(this.appMap[appId].package)) {
                        logger.debug("App found, pushing to appArr");
                        appArr.push({id: appId, friendlyName: this.appMap[appId].friendlyName, version: "unknown"});
                    } else {
                        logger.debug("App not found, ignoring");
                    }
                }
            }
            return { ...this.dabResponse(), ...{apps: appArr} };
        } catch (e) {
            logger.error(e);
            return this.dabResponse(500, e.message);
        }
    }

    launchApp = async (data) => {
        if (typeof data.appId !== "string")
            return this.dabResponse(400, "'appId' must be set as the application id to launch");

        try {
            data.appId = data.appId.toLowerCase();
            if (!this.appMap[data.appId] || !this.appMap[data.appId].intent)
                return this.dabResponse(404, `Couldn't find data for app ${data.appId} in config file`);

            let intent = this.appMap[data.appId].intent;
            if (data.parameters) {
                if (this.appMap[data.appId].optionsPrefix) {
                    logger.debug("Adding optionsPrefix to intent array");
                    intent = [ ...intent, ...this.appMap[data.appId].optionsPrefix ];
                }
                try {
                    if (typeof data.parameters === "object") data.parameters = JSON.stringify(data.parameters);
                    const parsedParams = JSON.parse(data.parameters);
                    if (Array.isArray(parsedParams)) {
                        logger.debug("Adding parameters to intent array");
                        intent = [ ...intent, ...parsedParams ];
                    } else if (typeof parsedParams === "object") {
                        logger.debug("Adding parameters as stringified object to intent array");
                        intent = [ ...intent, ...["'" + data.parameters + "'"] ];
                    }
                } catch(e) {
                    logger.debug("Appending parameters to last intent array value");
                    const appendedArg = intent[intent.length-1] + data.parameters;
                    let cloneIntent = [...intent]
                    cloneIntent.pop();
                    intent = [ ...cloneIntent, ...[appendedArg] ];
                }
            }

            await this.adb.start(intent);
            return this.dabResponse();
        } catch (e) {
            logger.error(e);
            return this.dabResponse(500, e.message);
        }
    }

    /**
     * Force stops the application
     */
    exitApp = async (data) => {
        if (typeof data.appId !== "string")
            return this.dabResponse(400, "'appId' must be set as the application id to exit");

        try {
            data.appId = data.appId.toLowerCase();
            if (!this.appMap[data.appId] || !this.appMap[data.appId].package)
                return this.dabResponse(404, `Couldn't find data for app ${data.appId} in config file`);

            await this.adb.stop(this.appMap[data.appId].package);
            return {...this.dabResponse(), state: "STOPPED"};
        } catch (e) {
            return this.dabResponse(500, e.message);
        }
    }

    restartDevice = async () => {
        const handleReboot = async () => {
            await this.notify("warn", "Device is rebooting and will be temporarily offline");
            await this.adb.reboot();
            await this.notify("info", "Device is back online following reboot");
        }
        handleReboot().catch((err) => { logger.error(err) });
        return this.dabResponse(202);
    }

    keyPress = async (data) => {
        if (typeof data.keyCode !== "string")
            return this.dabResponse(400, "'keyCode' must be set");

        try {
            await this.adb.sendKey(data.keyCode);
            return this.dabResponse();
        } catch (e) {
            if (e.message.startsWith("Unrecognized keyCode")){
                return this.dabResponse(401, e.message);
            }
            return this.dabResponse(500, e.message);
        }
    }

    startDeviceTelemetry = async (data) => {
        if (typeof data.frequency !== "number" || !Number.isInteger(data.frequency))
            return this.dabResponse(400, "'frequency' must be set as number of milliseconds between updates");

        const platformMinFrequency = config.get("adb.minTelemetryMillis");
        if (data.frequency < platformMinFrequency) {
            data.frequency =  platformMinFrequency; //Setting minimum frequency for Android
            logger.info(`Increased device telemetry frequency to minimum allowed: ${platformMinFrequency}ms`);
        }

        return await this.startDeviceTelemetryImpl(data, async () => {
            return await this.adb.top();
        })
    };

    stopDeviceTelemetry = async () => {
        return await this.stopDeviceTelemetryImpl();
    };

    healthCheck = async () => {
        return { ...this.dabResponse(), ...{healthy: typeof (await this.adb.getDeviceUptimeSeconds()) === "number" } };
    }
}
