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

import bunyan from 'bunyan';
import {readFileSync} from 'fs';
import { HIDDEN, RUNNING, STOPPED } from "./adb/app_status.js";
import {
  APPLICATION_STATE_BACKGROUND,
  APPLICATION_STATE_FOREGROUND,
  APPLICATION_STATE_STOPPED
} from "./dab/dab_constants.js";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function adbAppStatusToDabAppState(appStatus) {
  switch (appStatus) {
    case RUNNING:
      return APPLICATION_STATE_FOREGROUND;
    case HIDDEN:
      return APPLICATION_STATE_BACKGROUND
    case STOPPED:
      return APPLICATION_STATE_STOPPED;
  }
}

// Static logger
let logger;
export function getLogger() {
  if (!logger) {
    const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
    logger = bunyan.createLogger({
      name: packageJson.name,
      version: packageJson.version,
      streams: [
        {
          level: 'info',
          stream: process.stdout // log debug and above to stdout
        },
        // {
        //   level: 'info',
        //   path: 'dab_adb_bridge.log' // log ERROR and above to a file
        // }
      ],
      serializers: {err: bunyan.stdSerializers.err},
      src: true
    });
    // This removes the `v` field as its only needed by bunyan cli and useless to us.
    logger._emit = (rec, noemit) => {
      delete rec.v;
      bunyan.prototype._emit.call(logger, rec, noemit);
    };
  }

  return logger;
}
