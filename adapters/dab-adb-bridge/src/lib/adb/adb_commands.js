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
import * as APP_STATUS from './app_status.js';
import { KEY_CODES } from './adb_keymap.js';
import { spawn } from 'promisify-child-process';
import { getLogger, sleep } from "../util.js";
const logger = getLogger();

process.on("unhandledRejection", (reason, p) => {
    logger.debug("Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

export class AdbCommands {
    constructor(deviceId) {
        //Latest Linux ADB app is downloaded from https://developer.android.com/studio/releases/platform-tools.html
        this.adb = config.get("adb.binary");

        this.device = {
            id: deviceId,
            state: "unreachable",
            connection: undefined,
            ip: undefined,
            mac: undefined,
            networkType: "unknown",
            serial: undefined,
            resolution: {
                x: undefined,
                y: undefined
            },
            message: "ADB debugging is not available"
        };
        if (new RegExp(/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(:\d+)?$/).test(this.device.id)) {
            if (this.device.id.indexOf(":") > 0) {
                this.device.ip = this.device.id.substring(0, this.device.id.indexOf(":"));
            } else {
                this.device.ip = this.device.id;
                this.device.id = `${this.device.ip}:5555`;
            }
            this.device.connection = "tcp";
        } else {
            this.device.serial = this.device.id;
            this.device.connection = "usb";
        }
    }

    async init() {
        await this.devices();
        if (this.device.connection === "tcp") await this.connect();
    }

    async getDeviceDetails() {
        await this.init();
        return this.device;
    }

    async killServer() {
        logger.info("Terminating ADB Server");
        await spawn(this.adb, ["kill-server"]);
        return { message: `Killed adb at ${config.get("adb.binary")}` };
    }

    async disconnect() {
        logger.info(`Disconnecting: ${this.device.ip}`);
        await spawn(this.adb, ["disconnect", this.device.id], {
            encoding: "utf8",
        });
    }

    async connect() {
        if (
            !/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(:\d+)?$/.test(
                this.device.id
            )
        ) { throw new Error(`ADB connect request appears to be an invalid address: ${this.device.id}`); }

        logger.info(`Trying to TCP connect to ${this.device.id}`);
        const { stdout, stderr } = await spawn(this.adb, ["connect", this.device.id], {
            encoding: "utf8",
        });
        if (stderr.toString() !== "") {
            throw new Error("ADB connect output to stderr: " + stderr.toString());
        }

        let output = stdout
            .toString()
            .trim()
            .replace(/\r?\n|\r/, "");

        if (new RegExp("connected to " + this.device.ip).test(output)) {
            //Gives a device a chance to get its status right, before giving up
            for (let i = 0; i < 2; i++) {
                await this.devices();
                if (this.device.state === "ready") {
                    logger.info(`ADB connected: ${this.device.id}`);
                    return;
                }
                await sleep(1000);
            }
            logger.info(
                `ADB connected to ${this.device.id} but device not ready: ${JSON.stringify(this.device)}`
            );
        } else if (new RegExp("unable to connect").test(output)
            || new RegExp("failed to connect").test(output)
            || new RegExp("Connection refused").test(output)) {
            logger.info(`ADB unable to connect: ${this.device.id}`);
            throw new Error("ADB debugging is disabled or it is not an Android device");
        } else {
            logger.error(`Unrecognized command output: ${output}`);
            throw new Error(`Unrecognized command output connecting: ${output}`);
        }
    }

    async devices() {
        let foundDevice = false;
        try {
            const { stdout, stderr } = await spawn(this.adb, ["devices", "-l"], { encoding: "utf8" });
            if (stderr.toString() !== "") {
                logger.warn(`adb devices output to stderr: ${stderr.toString()}`);
            }

            let outputArr = stdout.split("\n");
            let promises = outputArr.map(async (line) => {
                //If the line is static output, ignore it
                if (new RegExp(/List of devices attached/).test(line)) return;

                //If this isn't the device we're interested in, ignore it
                if (!new RegExp(this.device.id).test(line)) return;

                foundDevice = true;

                line = line
                    .trim()
                    .replace(/\s+/, " ")
                    .replace(/\r?\n|\r/, "");

                let columns = line.split(" ");

                if (columns.length < 1) return;

                if (columns.length >= 2) {
                    this.device.state = columns[1];
                    switch (this.device.state) {
                        case "device":
                            this.device.state = "ready";
                            this.device.message = undefined;
                            this.device.properties = await this.getDeviceProps();
                            if (!this.device.serial) {
                                this.device.serial = this.device.properties["ro.boot.serialno"];
                            }
                            if (this.device.id.startsWith(this.device.ip)) {
                                this.device.networkType = await this.getNetworkType();
                            } else {
                                this.device.networkType = "other";
                            }
                            if (!this.device.ip) {
                                const ipArr = await this.getDeviceIpsFromSerial(this.device.serial);
                                if (ipArr.length === 1) {
                                    this.device.ip = ipArr[0];
                                } else {
                                    this.device.ip = ipArr;
                                }
                            }
                            if (this.device.ip && !this.device.mac) {
                                if (Array.isArray(this.device.ip)) {
                                    const macArr = [];
                                    for (const ipAddress of this.device.ip) {
                                        macArr.push(await this.getDeviceMacFromIp(ipAddress));
                                    }
                                    this.device.mac = macArr;
                                } else {
                                    this.device.mac = await this.getDeviceMacFromIp(this.device.ip);
                                }
                            }
                            if (this.device.properties["vendor.display-size"]) {
                                const resolutionArr = this.device.properties["vendor.display-size"].split("x");
                                this.device.resolution.x = Number.parseInt(resolutionArr[0]);
                                this.device.resolution.y = Number.parseInt(resolutionArr[1]);
                            }
                            break;
                        case "authorizing":
                            this.device.message = "Connection is being authorized";
                            break;
                        case "unauthorized":
                            this.device.message = "Please grant ADB debug permission on the device";
                            break;
                        case "offline":
                            this.device.message =
                                "ADB reports offline, try toggling ADB debugging on/off, revoking ADB permissions or power cycling the device";
                            break;
                        default:
                            logger.warn(`ADB devices reported unhandled state: ${this.device.state}`);
                    }
                }
            });

            await Promise.all(promises);
            if (!foundDevice) {
                this.device.state = "unknown";
                this.device.message = "Device details are currently unavailable";
            }
        } catch (err) {
            logger.error(err, "An exception occurred getting adb devices details");
        }
    }

    async getDeviceProps() {
        logger.info(`Getting device properties for ${this.device.id}`);
        try {
            const { stdout, stderr } = await spawn(
                this.adb,
                ["-s", this.device.id, "shell", "getprop"],
                { encoding: "utf8" }
            );
            if (stderr.toString() !== "") {
                logger.error(`getDeviceProps output to stderr: ${stderr.toString()}`);
                return;
            }
            const outputArr = stdout
                .replace(/\r?\n|\r/g, "%%") // replace newlines with '%%' to fix multi-line properties
                .replace(/]%%\[/g, "]\n[") // re-add newline between different properties
                .split("\n");
            const propObj = {};
            for (let line of outputArr) {
                line = line.trim().replace(/\s+/, " ").replace(/\r?\n|\r/, "");
                if (line.length === 0) continue;
                const match = line.match(/\[(.*)]:\s\[(.*)]/);
                propObj[match[1]] = match[2];
            }
            return propObj;
        } catch (err) {
            logger.error(
                `An exception occurred determining device properties for ${this.device.id}: ${err.message}`
            );
        }
    }

    async getDeviceUptimeSeconds() {
        logger.info(`Getting device uptime for ${this.device.id}`);
        try {
            const { stdout, stderr } = await spawn(
                this.adb,
                ["-s", this.device.id, "shell", "cat", "/proc/uptime"],
                { encoding: "utf8" }
            );
            if (stderr.toString() !== "") {
                logger.error(`getDeviceUptimeSeconds output to stderr: ${stderr.toString()}`);
                return;
            }

            return Number.parseFloat(stdout.substring(0, stdout.indexOf(" ")));
        } catch (err) {
            logger.error(
                `An exception occurred getting device uptime for ${this.device.id}: ${err.message}`
            );
        }
    }

    async getNetworkType() {
        logger.info(`Getting device active NIC type for ${this.device.id}`);
        try {
            const { stdout, stderr } = await spawn(
                this.adb,
                ["-s", this.device.id, "shell", "ip", "addr"],
                { encoding: "utf8" }
            );
            if (stderr.toString() !== "") {
                logger.error(`getActiveNicType output to stderr: ${stderr.toString()}`);
                return;
            }
            let outputArr = stdout.split("\n");
            for (let line of outputArr) {
                if (/wlan.*state UP/.test(line) ) {
                    return "wifi";
                } else if (/eth.*state UP/.test(line) ) {
                    return "ethernet";
                }
            }
            return "unknown";
        } catch (err) {
            logger.error(
                `An exception occurred determining device active NIC type for ${this.device.id}: ${err.message}`
            );
        }
    }

    async getDeviceIpsFromSerial() {
        logger.info(`Getting IPs for ${this.device.serial}`);
        try {
            const { stdout, stderr } = await spawn(this.adb, ["-s", this.device.id, "shell", "ifconfig"], {
                encoding: "utf8",
            });
            if (stderr.toString() !== "") {
                logger.error(`getDeviceIpFromSerial output to stderr: ${stderr.toString()}`);
                return;
            }
            const ipRegex = /addr:(\b(?:\d{1,3}\.){3}\d{1,3}\b)/g;
            let matches,
                addresses = [];
            while ((matches = ipRegex.exec(stdout))) {
                if (matches[1] !== "127.0.0.1") addresses.push(matches[1]);
            }
            return addresses;
        } catch (err) {
            logger.error(`An exception occurred getting device IPs for ${this.device.serial}`);
        }
    }

    async getDeviceMacFromIp(ipAddress) {
        logger.info(`Getting MAC for ${ipAddress}`);
        try {
            const { stdout, stderr } = await spawn(this.adb, ["-s", this.device.id, "shell", "ip", "address"], {
                encoding: "utf8",
            });
            if (stderr.toString() !== "") {
                logger.error(`getDeviceMacFromIp output to stderr: ${stderr.toString()}`);
                return;
            }
            const interfaceRegex = /^\d+: ((?:(?!^\d).)*)/gms;
            let matches;
            while ((matches = interfaceRegex.exec(stdout))) {
                //Only looking for MAC of the specified IP
                if (matches[1].indexOf(ipAddress) === -1) continue;

                //Extract the MACs
                let macAddress = matches[1].match(/\s([a-fA-F0-9:]{17}|[a-fA-F0-9]{12})\s\w+/);

                return macAddress[1];
            }
        } catch (err) {
            logger.error(err, `An exception occurred getting MAC for ${ipAddress}`);
        }
    }

    async getPackages() {
        logger.info(`Retrieve package list on ${this.device.id}`);
        const { stdout, stderr } = await spawn(
            this.adb,
            ["-s", this.device.id, "shell", "pm", "list", "packages"],
            { encoding: "utf8" }
        );

        if (stderr.toString() !== "") {
            throw new Error(`ADB list packages output to stderr: ${stderr.toString()}`);
        }

        return stdout
            .toString()
            .trim()
            .replace(/package:/g, "")
            .replace(/\r?\n|\r/, "")
            .split("\n");
    }

    async start(intentArr) {
        if (!intentArr) throw new Error("Intent to start was not specified");

        let startArgs = [ ...["-s", this.device.id, "shell", "am", "start"], ...intentArr ];

        logger.info(`Starting intent on ${this.device.id} w/ args: ${startArgs}`);
        const { stdout, stderr } = await spawn(this.adb, startArgs, { encoding: "utf8" });

        if (stderr.toString() !== "") {
            //Catching the warning here due to app is already running condition
            //What is printed on stderr is different in Android P, the second condition matches it
            if (
                new RegExp("current task has been brought to the front").test(stderr.toString()) ||
                new RegExp("intent has been delivered to currently running top-most instance").test(
                    stderr.toString()
                )
            ) {
                logger.warn(`ADB start resumed current instance with message: ${stderr.toString()}`);
                return;
            } else {
                throw new Error(`ADB start output to stderr: ${stderr.toString()}`);
            }
        }

        let output = stdout
            .toString()
            .trim()
            .replace(/\r?\n|\r/, "");

        if (!new RegExp("Starting: Intent { ").test(output)) {
            throw new Error(`Failed to start ${intentArr} on ${this.device.id}: ${stdout}`);
        }
    }

    async stop(appPackage) {
         if (!appPackage || typeof appPackage !== "string" || appPackage.trim() === "") {
            throw new Error("App package to stop was not specified");
        }

        logger.debug(`Stopping ${appPackage} on ${this.device.id}`);
        const { stdout, stderr } = await spawn(
            this.adb,
            ["-s", this.device.id, "shell", "am", "force-stop", appPackage],
            { encoding: "utf8" }
        );

        if (stderr.toString() !== "") {
            throw new Error(`ADB stop output to stderr: ${stderr.toString()}`);
        }

        let output = stdout
            .toString()
            .trim()
            .replace(/\r?\n|\r/, "");

        if (new RegExp(appPackage).test(output)) {
            throw new Error(`Failed to stop ${appPackage} on ${this.device.id}`);
        }
    }

    async expectStatus(appPackage, expectedState, timeoutSeconds) {
        if (!appPackage || typeof appPackage !== "string" || appPackage.trim() === "") {
            throw new Error("App package to stop was not specified");
        }

        let expectedAppStatus = APP_STATUS[expectedState.toUpperCase()];
        if (!expectedAppStatus) {
            throw new Error(`Expected status was not recognized: ${expectedState}`);
        }

        if (timeoutSeconds && typeof timeoutSeconds !== "number") {
            throw new Error(`Timeout seconds was not parsable: ${timeoutSeconds}`);
        }
        if (!timeoutSeconds) {
            timeoutSeconds = 10;
        }

        let timeout = Date.now() + timeoutSeconds * 1000;

        const waitStatus = async () => {
            let currentStatus = await this.status(appPackage);
            if (currentStatus.state === expectedAppStatus) {
                //resolve(true) here because we found we have a match!
                return currentStatus;
            } else {
                if (Date.now() > timeout) {
                    //We've timed out, so reject
                    throw new Error(
                        `Expected status ${expectedAppStatus} was not detected within ${timeoutSeconds} seconds`
                    );
                } else {
                    await sleep(500);
                    //Haven't timed out, so should re-poll status now
                    return await waitStatus();
                }
            }
        };

        logger.info(`Awaiting ADB ${expectedAppStatus} confirmation`);
        return await waitStatus();
    }

    async status(appPackage) {
        if (!appPackage || typeof appPackage !== "string" || appPackage.trim() === "") {
            throw new Error("App package to stop was not specified");
        }

        this.device.useStatus2 = false;

        const callStatus = async () => {
            if (this.device.useStatus2) {
                logger.debug("Calling status2 impl");
                return await this.#status2(appPackage);
            } else {
                try {
                    return await this.#status1(appPackage);
                } catch (e) {
                    logger.debug("status1 impl failed, switching to status2 impl");
                    this.device.useStatus2 = true;
                    return await callStatus();
                }
            }
        };

        return {
            package: appPackage,
            state: await callStatus(),
        };
    }

    async #status1(appPackage) {
        logger.info(`Checking app ${appPackage} on ${this.device.id}`);
        const { stdout, stderr } = await spawn(this.adb,
            ["-s", this.device.id, "shell", "am", "stack", "list"], {
            encoding: "utf8",
        });

        if (stderr.toString() !== "") {
            throw new Error(`ADB status1 output to stderr: ${stderr.toString()}`);
        }

        logger.debug(stdout);

        let state = APP_STATUS.STOPPED;
        let output = stdout.toString().split(/[\r\n]+/);

        if (new RegExp("Exception").test(output) || new RegExp("Error:").test(output)) {
            throw new Error(`Failed to get app status for ${appPackage} on ${this.device.id}: ${stdout}`);
        }

        output.forEach((line) => {
            if (new RegExp(appPackage).test(line)) {
                //Netflix package is in the stack, so lets see if running or hidden
                if (new RegExp("visible=true").test(line)) {
                    state = APP_STATUS.RUNNING;
                } else if (new RegExp("visible=false").test(line)) {
                    state = APP_STATUS.HIDDEN;
                }
            }
        });
        logger.info(`Package ${appPackage} on ${this.device.id} status: ${state}`);
        return state;
    }

    async #status2(appPackage) {
        logger.info(`Checking app ${appPackage} on ${this.device.id}`);
        const { stdout, stderr } = await spawn(
            this.adb,
            ["-s", this.device.id, "shell", "dumpsys", "window", "windows"],
            {
                encoding: "utf8",
            }
        );

        if (stderr.toString() !== "") {
            throw new Error(`ADB status2 output to stderr: ${stderr.toString()}`);
        }

        logger.debug(stdout);

        if (new RegExp("Exception").test(stdout)) {
            throw new Error(`Failed to get app status for ${appPackage} on ${this.device.id}: ${stdout}`);
        }

        let packageRegex = new RegExp(
            "package=" + appPackage + ".+([\\s\\S]*?)+?isReadyForDisplay\\(\\)=(\\w+)"
        );
        let match = packageRegex.exec(stdout.toString());

        let state;
        if (match === null || match[2] === undefined) {
            state = APP_STATUS.STOPPED;
        } else if (match[2] === "true") {
            state = APP_STATUS.RUNNING;
        } else if (match[2] === "false") {
            state = APP_STATUS.HIDDEN;
        } else {
            throw new Error(`Failed to parse app status for ${appPackage} on ${this.device.id}: ${stdout}`);
        }
        logger.info(`Package ${appPackage} on ${this.device.id} status: ${state}`);
        return state;
    }

    async sendKey(keyCode) {
        let keyVal = KEY_CODES[keyCode];
        if (isNaN(keyVal)) {
            throw new Error(
                "Unrecognized keyCode was specified, no event code could be located: " + keyCode
            );
        }

        logger.debug(`Typing key event ${keyCode} as input on ${this.device.id}`);
        const { stdout, stderr } = await spawn(
            this.adb,
            ["-s", this.device.id, "shell", "input", "keyevent", keyVal],
            {
                encoding: "utf8",
            }
        );

        if (stderr.toString() !== "") {
            throw new Error(`ADB sendKey output to stderr: ${stderr.toString()}`);
        }

        logger.info(`Typed key on ${this.device.id}: ${stdout}`);
    }

    async reboot() {
        return new Promise(async (resolve, reject) => {
            logger.info(`Rebooting ${this.device.id}`);
            spawn(this.adb, ["-s", this.device.id, "reboot"], {
                encoding: "utf8",
            });

            const timer = setTimeout(()=> {
                return reject(new Error("Reconnection timeout following reboot"));
            }, config.get("adb.rebootTimeoutMs"));

            if (this.device.connection === "tcp") await this.disconnect();

            this.device.state = "rebooting";

            while(this.device.state !== "ready") {
                await sleep(5000);
                try {
                    await this.init();
                } catch (e) {
                    //Expected on reboot }
                }
            }
            clearTimeout(timer);
            logger.info(`Rebooted ${this.device.id}`);
            resolve();
        })
    }

    async top() {
        logger.debug(`Running top on ${this.device.id}`);
        const { stdout, stderr } = await spawn(this.adb, ["-s", this.device.id, "shell", "top", "-n", "1"], {
            encoding: "utf8",
        });

        if (stderr.toString() !== "") {
            throw new Error(`ADB top output to stderr: ${stderr.toString()}`);
        }

        let matchedData = stdout.match(/Tasks:([\s\S]+)Mem:([\s\S]+)Swap:([\s\S]+cached)/);
        if (matchedData) {
            for (let i=1; i<matchedData.length; i++) {
                matchedData[i] = matchedData[i].trim()
                    .replace(/\r\n/g, ",")
                    .replace(/\s+/g, " ")
                    .split(",")
            }
        }

        return {
            tasks: matchedData[1],
            memory: matchedData[2],
            swap: matchedData[3],
        };
    }
}
