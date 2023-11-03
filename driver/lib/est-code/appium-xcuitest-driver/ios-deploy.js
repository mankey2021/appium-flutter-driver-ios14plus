"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const support_1 = require("appium/support");
const path_1 = __importDefault(require("path"));
const appium_ios_device_1 = require("appium-ios-device");
const bluebird_1 = __importDefault(require("bluebird"));
const logger_1 = __importDefault(require("./logger"));
const lodash_1 = __importDefault(require("lodash"));
const teen_process_1 = require("teen_process");
const app_utils_1 = require("./app-utils");
const ios_fs_helpers_1 = require("./ios-fs-helpers");
const xcrun_1 = require("./xcrun");
const APPLICATION_INSTALLED_NOTIFICATION = 'com.apple.mobile.application_installed';
const INSTALLATION_STAGING_DIR = 'PublicStaging';
const APPLICATION_NOTIFICATION_TIMEOUT_MS = 30 * 1000;
const IOS_DEPLOY_TIMEOUT_MS = 4 * 60 * 1000;
const IOS_DEPLOY = 'ios-deploy';
const APP_INSTALL_STRATEGY = Object.freeze({
    SERIAL: 'serial',
    PARALLEL: 'parallel',
    IOS_DEPLOY,
});
//----------EST CODE----------
//----------------------------
let proc;
//----------------------------
//----------EST CODE----------

class IOSDeploy {
    constructor(udid) {
        this.udid = udid;
    }
    async remove(bundleId) {
        const service = await appium_ios_device_1.services.startInstallationProxyService(this.udid);

        //----------EST CODE----------
        //----------------------------
        try {
            await proc.stop();
        } catch (err1) {
        }
        //----------------------------
        //----------EST CODE----------

        try {
            await service.uninstallApplication(bundleId);
        }
        finally {
            service.close();
        }
    }
    async removeApp(bundleId) {
        await this.remove(bundleId);
    }

    //----------EST CODE----------
    //----------------------------
    async launchApp(app, processArguments) {
        try {
        proc = new _teen_process.SubProcess(IOS_DEPLOY, ['--id', this.udid, '--bundle', app, '--noinstall', '--debug', '--verbose', '--args', processArguments.toString().replace(/,/g, " ")]);
        let sd = (stdout) => {
            return stdout.indexOf("The Dart VM service is listening on") !== -1;
        };
        proc.on('stream-line', line => {
            if (line.includes(`The Dart VM service is listening on`)) {
            const observatoryUriRegEx = new RegExp(`(Observatory listening on |An Observatory debugger and profiler on\\s.+\\sis available at: |The Dart VM service is listening on )((http|\/\/)[a-zA-Z0-9:/=_\\-\.\\[\\]]+)`);
            const observatoryMatch = line.match(observatoryUriRegEx);
            const dartObservatoryURI = observatoryMatch[2];
            processArguments.push('observatoryWsUri', dartObservatoryURI);
            }
            _logger.default.debug(`ios-deploy: ${line}`);
        });
        await proc.start(sd, 300000);
        } catch (err1) {
        throw new Error(`Could not launch '${app}':\n` + `  - ${err.message}\n` + `  - ${err1.stderr || err1.stdout || err1.message}`);
        }
    }
    //----------------------------
    //----------EST CODE----------

    /**
     *
     * @param {string} app
     * @param {number} [timeout]
     * @param {'ios-deploy'|'serial'|'parallel'|null} strategy
     * @privateRemarks This really needs type guards built out
     */
    async install(app, timeout, strategy = null) {
        if (strategy &&
            !lodash_1.default.values(APP_INSTALL_STRATEGY).includes(/** @type {any} */ (lodash_1.default.toLower(strategy)))) {
            throw new Error(`App installation strategy '${strategy}' is unknown. ` +
                `Only the following strategies are supported: ${lodash_1.default.values(APP_INSTALL_STRATEGY)}`);
        }
        logger_1.default.debug(`Using '${strategy ?? APP_INSTALL_STRATEGY.SERIAL}' app deployment strategy. ` +
            `You could change it by providing another value to the 'appInstallStrategy' capability`);
        const installWithIosDeploy = async () => {
            try {
                await support_1.fs.which(IOS_DEPLOY);
            }
            catch (err) {
                throw new Error(`'${IOS_DEPLOY}' utility has not been found in PATH. Is it installed?`);
            }
            try {
                await (0, teen_process_1.exec)(IOS_DEPLOY, ['--id', this.udid, '--bundle', app], {
                    timeout: timeout ?? IOS_DEPLOY_TIMEOUT_MS,
                });
            }
            catch (err) {
                throw new Error(err.stderr || err.stdout || err.message);
            }
        };
        const timer = new support_1.timing.Timer().start();
        if (lodash_1.default.toLower(/** @type {'ios-deploy'} */ (strategy)) === APP_INSTALL_STRATEGY.IOS_DEPLOY) {
            await installWithIosDeploy();
        }
        else {
            const afcService = await appium_ios_device_1.services.startAfcService(this.udid);
            try {
                const bundleId = await (0, app_utils_1.extractBundleId)(app);
                const bundlePathOnPhone = path_1.default.join(INSTALLATION_STAGING_DIR, bundleId);
                await (0, ios_fs_helpers_1.pushFolder)(afcService, app, bundlePathOnPhone, {
                    timeoutMs: timeout,
                    enableParallelPush: lodash_1.default.toLower(/** @type {'parallel'} */ (strategy)) === APP_INSTALL_STRATEGY.PARALLEL,
                });
                await this.installOrUpgradeApplication(bundlePathOnPhone, await this.isAppInstalled(bundleId));
            }
            catch (err) {
                logger_1.default.warn(`Error installing app '${app}': ${err.message}`);
                if (err instanceof bluebird_1.default.TimeoutError) {
                    logger_1.default.warn(`Consider increasing the value of 'appPushTimeout' capability`);
                }
                logger_1.default.warn(`Falling back to '${IOS_DEPLOY}' usage`);
                try {
                    await installWithIosDeploy();
                }
                catch (err1) {
                    throw new Error(`Could not install '${app}':\n` + `  - ${err.message}\n` + `  - ${err1.message}`);
                }
            }
            finally {
                afcService.close();
            }
        }
        logger_1.default.info(`App installation succeeded after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);
    }
    async installOrUpgradeApplication(bundlePathOnPhone, isUpgrade = false) {
        const notificationService = await appium_ios_device_1.services.startNotificationProxyService(this.udid);
        const installationService = await appium_ios_device_1.services.startInstallationProxyService(this.udid);
        const appInstalledNotification = new bluebird_1.default((resolve) => {
            notificationService.observeNotification(APPLICATION_INSTALLED_NOTIFICATION, {
                notification: resolve,
            });
        });
        const clientOptions = { PackageType: 'Developer' };
        try {
            if (isUpgrade) {
                logger_1.default.debug(`An upgrade of the existing application is going to be performed`);
                await installationService.upgradeApplication(bundlePathOnPhone, clientOptions);
            }
            else {
                logger_1.default.debug(`A new application installation is going to be performed`);
                await installationService.installApplication(bundlePathOnPhone, clientOptions);
            }
            try {
                await appInstalledNotification.timeout(APPLICATION_NOTIFICATION_TIMEOUT_MS, `Could not get the application installed notification within ` +
                    `${APPLICATION_NOTIFICATION_TIMEOUT_MS}ms but we will continue`);
            }
            catch (e) {
                logger_1.default.warn(`Failed to receive the notification. Error: ${e.message}`);
            }
        }
        finally {
            installationService.close();
            notificationService.close();
        }
    }
    /**
     * Alias for {@linkcode install}
     * @param {string} app
     * @param {number} timeout
     * @param {'ios-deploy'|'serial'|'parallel'|null} strategy
     */
    async installApp(app, timeout, strategy) {
        return await this.install(app, timeout, strategy);
    }
    /**
     * Return an application object if test app has 'bundleid'.
     * The target bundleid can be User and System apps.
     *
     * @param {string} bundleId The bundleId to ensure it is installed
     * @return {Promise<boolean>} Returns True if the app is installed
     * on the device under test.
     */
    async isAppInstalled(bundleId) {
        return Boolean(await this.fetchAppInfo(bundleId));
    }
    /**
     * Fetches various attributes, like bundle id, version, entitlements etc. of
     * an installed application.
     *
     * @param {string} bundleId the bundle identifier of an app to check
     * @param {string|string[]|undefined} returnAttributes If provided then
     * only fetches the requested attributes of the app into the resulting object.
     * Some apps may have too many attributes, so it makes sense to limit these
     * by default if you don't need all of them.
     * @returns {Promise<Object|undefined>} Either app info as an object or undefined
     * if the app is not found.
     */
    async fetchAppInfo(bundleId, returnAttributes = ['CFBundleIdentifier', 'CFBundleVersion']) {
        const service = await appium_ios_device_1.services.startInstallationProxyService(this.udid);
        try {
            return (await service.lookupApplications({
                bundleIds: bundleId,
                // https://github.com/appium/appium/issues/18753
                returnAttributes,
            }))[bundleId];
        }
        finally {
            service.close();
        }
    }
    async terminateApp(bundleId, platformVersion) {
        let instrumentService;
        let installProxyService;
        try {
            installProxyService = await appium_ios_device_1.services.startInstallationProxyService(this.udid);
            const apps = await installProxyService.listApplications();
            if (!apps[bundleId]) {
                logger_1.default.info(`The bundle id '${bundleId}' did not exist`);
                return false;
            }
            const executableName = apps[bundleId].CFBundleExecutable;
            logger_1.default.debug(`The executable name for the bundle id '${bundleId}' was '${executableName}'`);
            // 'devicectl' has overhead (generally?) than the instrument service via appium-ios-device,
            // so hre uses the 'devicectl' only for iOS 17+.
            if (support_1.util.compareVersions(platformVersion, '>=', '17.0')) {
                logger_1.default.debug(`Calling devicectl to kill the process`);
                // FIXME: replace `devicectl` command with a wrapper later
                // or remove after implementing appium-ios-device for iOS 17+.
                const xcrunBinnaryPath = await (0, xcrun_1.requireXcrun)();
                const { stdout } = await (0, teen_process_1.exec)(xcrunBinnaryPath, [
                    'devicectl',
                    'device',
                    'info',
                    'processes',
                    `--device`, this.udid
                ]);
                // Each line has spaces. devicectl has JSON output option, but it writes it to a file only.
                // Here parse the standard output directly.
                // e.g.:
                // 823   /private/var/containers/Bundle/Application/8E748312-8CBE-4C13-8295-C2EF3ED2C0C1/WebDriverAgentRunner-Runner.app/WebDriverAgentRunner-Runner
                // 824   /Applications/MobileSafari.app/MobileSafari
                // 825   /usr/libexec/debugserver
                const executableLine = stdout.split('\n').find((line) => line.trim().endsWith(executableName));
                if (!executableLine) {
                    logger_1.default.info(`The process of the bundle id '${bundleId}' was not running`);
                    return false;
                }
                await (0, teen_process_1.exec)(xcrunBinnaryPath, [
                    'devicectl',
                    'device',
                    'process',
                    'signal',
                    '-s', `2`,
                    // e.g.
                    // '824   /Applications/MobileSafari.app/MobileSafari              '
                    // ' 999   /Applications/MobileSafari.app/MobileSafari              '  (can include spaces in the top)
                    '-p', `${executableLine.trim().split(/\s+/)[0]}`,
                    `--device`, this.udid
                ]);
            }
            else {
                instrumentService = await appium_ios_device_1.services.startInstrumentService(this.udid);
                const processes = await instrumentService.callChannel(appium_ios_device_1.INSTRUMENT_CHANNEL.DEVICE_INFO, 'runningProcesses');
                const process = processes.selector.find((process) => process.name === executableName);
                if (!process) {
                    logger_1.default.info(`The process of the bundle id '${bundleId}' was not running`);
                    return false;
                }
                await instrumentService.callChannel(appium_ios_device_1.INSTRUMENT_CHANNEL.PROCESS_CONTROL, 'killPid:', `${process.pid}`);
            }
        }
        catch (err) {
            logger_1.default.warn(`Failed to kill '${bundleId}'. Original error: ${err.stderr || err.message}`);
            return false;
        }
        finally {
            if (installProxyService) {
                installProxyService.close();
            }
            if (instrumentService) {
                instrumentService.close();
            }
        }
        return true;
    }
    /**
     * @param {string} bundleName The name of CFBundleName in Info.plist
     *
     * @returns {Promise<string[]>} A list of User level apps' bundle ids which has
     *                          'CFBundleName' attribute as 'bundleName'.
     */
    async getUserInstalledBundleIdsByBundleName(bundleName) {
        const service = await appium_ios_device_1.services.startInstallationProxyService(this.udid);
        try {
            const applications = await service.listApplications({ applicationType: 'User' });
            return lodash_1.default.reduce(applications, (acc, { CFBundleName }, key) => {
                if (CFBundleName === bundleName) {
                    acc.push(key);
                }
                return acc;
            }, 
            /** @type {string[]} */ ([]));
        }
        finally {
            service.close();
        }
    }
    async getPlatformVersion() {
        return await appium_ios_device_1.utilities.getOSVersion(this.udid);
    }
}
exports.default = IOSDeploy;
//# sourceMappingURL=ios-deploy.js.map