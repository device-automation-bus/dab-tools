# DAB <=> ADB Bridge

The bridge app is a Node.js application that translates DAB requests into [ADB](https://developer.android.com/studio/command-line/adb) commands and ADB output into DAB responses. Since DAB is intended to support a single device with multiple clients, a single instance of this app can only manage a single Android device via a single MQTT broker.

## Installation

1. Ensure that ADB Debugging is enabled on the AndroidTV device.
   Go to `Settings > Device Preferences`. If there's no `{} Developer options` option, you must first enable it by going
   to `Settings > Device Preferences > About > Build` and clicking on it 7 times, or until you're notified that you're now a developer.

2. Make sure that ADB is installed and working on your platform. [Install link](https://developer.android.com/studio/releases/platform-tools).
    1. ADB can also be installed on macOS using Homebrew (`brew install android-platform-tools`)

3. Connect to the device using ADB (this can be done over the network or via USB cable):
    1. To connect via USB, connect a cable from the device to your computer and run the following command, where you
       should see the Android serial of your device now listed
       ```bash
       adb devices
       ```
    2. To connect via TCP, you'll need to determine the IP address of your device under
       `Settings > Developer options > Network debugging` and run
       ```bash
       adb connect <ipAddress>
       adb devices
       ```
   If your device is not listed or requires acknowledgement of the pairing request, correct any issues before proceeding to next step
4. Make sure you're running Node 14 and upgrade if necessary
   ```bash
   node --version
   ```
5. Install the required dependencies for the bridge app
    ```bash
    npm install
    ```
6. Edit the `config/default.json` file to set the path to the `adb > binary` executable on your computer and replace
   the `adb > device` string "deviceIpOrSerialHere" with either the IP address or Android serial of the device you wish
   to automate. The app will automatically handle the connection going forward.

## Usage
1. Start a MQTT broker. For example using the [Aedes CLI](https://www.npmjs.com/package/aedes-cli):
   ```bash
   npx aedes-cli
   ```
   If your MQTT broker isn't on your local computer, you'll also need to set the "mqttBroker" value in
   `config/default.json` to its URI.
2. Start the DAB<=>ADB Bridge. In a terminal, run:
   ```bash
   npm run start
   # Logs will print to console indicating connection state and any activities
   # the bridge is performing
   ```

3. Various DAB sample commands can be run against the bridge from a separate terminal:
   ```bash
   npm run test
   # Logs will print to console indicating requests and responses received
   ```

The DAB<=>ADB Bridge can be shut down by giving focus to the terminal running the bridge and sending Ctrl-C
