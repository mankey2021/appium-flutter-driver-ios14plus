"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

require("source-map-support/register");

var _support = require("appium/support");

var _path = _interopRequireDefault(require("path"));

var _appiumIosDevice = require("appium-ios-device");

var _bluebird = _interopRequireDefault(require("bluebird"));

var _logger = _interopRequireDefault(require("./logger"));

var _lodash = _interopRequireDefault(require("lodash"));

var _teen_process = require("teen_process");

var _appUtils = require("./app-utils");

var _iosFsHelpers = require("./ios-fs-helpers");

const APPLICATION_INSTALLED_NOTIFICATION = 'com.apple.mobile.application_installed';
const INSTALLATION_STAGING_DIR = 'PublicStaging';
const APPLICATION_NOTIFICATION_TIMEOUT_MS = 30 * 1000;
const IOS_DEPLOY_TIMEOUT_MS = 4 * 60 * 1000;
const IOS_DEPLOY = 'ios-deploy';
const APP_INSTALL_STRATEGY = Object.freeze({
  SERIAL: 'serial',
  PARALLEL: 'parallel',
  IOS_DEPLOY
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
    const service = await _appiumIosDevice.services.startInstallationProxyService(this.udid);

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
    } finally {
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

  async install(app, timeout, strategy = null) {
    if (strategy && !_lodash.default.values(APP_INSTALL_STRATEGY).includes(_lodash.default.toLower(strategy))) {
      throw new Error(`App installation strategy '${strategy}' is unknown. ` + `Only the following strategies are supported: ${_lodash.default.values(APP_INSTALL_STRATEGY)}`);
    }

    _logger.default.debug(`Using '${strategy !== null && strategy !== void 0 ? strategy : APP_INSTALL_STRATEGY.SERIAL}' app deployment strategy. ` + `You could change it by providing another value to the 'appInstallStrategy' capability`);

    const installWithIosDeploy = async () => {
      try {
        await _support.fs.which(IOS_DEPLOY);
      } catch (err) {
        throw new Error(`'${IOS_DEPLOY}' utility has not been found in PATH. Is it installed?`);
      }

      try {
        await (0, _teen_process.exec)(IOS_DEPLOY, ['--id', this.udid, '--bundle', app], {
          timeout: timeout !== null && timeout !== void 0 ? timeout : IOS_DEPLOY_TIMEOUT_MS
        });
      } catch (err) {
        throw new Error(err.stderr || err.stdout || err.message);
      }
    };

    const timer = new _support.timing.Timer().start();

    if (_lodash.default.toLower(strategy) === APP_INSTALL_STRATEGY.IOS_DEPLOY) {
      await installWithIosDeploy();
    } else {
      const afcService = await _appiumIosDevice.services.startAfcService(this.udid);

      try {
        const bundleId = await (0, _appUtils.extractBundleId)(app);

        const bundlePathOnPhone = _path.default.join(INSTALLATION_STAGING_DIR, bundleId);

        await (0, _iosFsHelpers.pushFolder)(afcService, app, bundlePathOnPhone, {
          timeoutMs: timeout,
          enableParallelPush: _lodash.default.toLower(strategy) === APP_INSTALL_STRATEGY.PARALLEL
        });
        await this.installOrUpgradeApplication(bundlePathOnPhone, await this.isAppInstalled(bundleId));
      } catch (err) {
        _logger.default.warn(`Error installing app '${app}': ${err.message}`);

        if (err instanceof _bluebird.default.TimeoutError) {
          _logger.default.warn(`Consider increasing the value of 'appPushTimeout' capability`);
        }

        _logger.default.warn(`Falling back to '${IOS_DEPLOY}' usage`);

        try {
          await installWithIosDeploy();
        } catch (err1) {
          throw new Error(`Could not install '${app}':\n` + `  - ${err.message}\n` + `  - ${err1.message}`);
        }
      } finally {
        afcService.close();
      }
    }

    _logger.default.info(`App installation succeeded after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);
  }

  async installOrUpgradeApplication(bundlePathOnPhone, isUpgrade = false) {
    const notificationService = await _appiumIosDevice.services.startNotificationProxyService(this.udid);
    const installationService = await _appiumIosDevice.services.startInstallationProxyService(this.udid);
    const appInstalledNotification = new _bluebird.default(resolve => {
      notificationService.observeNotification(APPLICATION_INSTALLED_NOTIFICATION, {
        notification: resolve
      });
    });
    const clientOptions = {
      PackageType: 'Developer'
    };

    try {
      if (isUpgrade) {
        _logger.default.debug(`An upgrade of the existing application is going to be performed`);

        await installationService.upgradeApplication(bundlePathOnPhone, clientOptions);
      } else {
        _logger.default.debug(`A new application installation is going to be performed`);

        await installationService.installApplication(bundlePathOnPhone, clientOptions);
      }

      try {
        await appInstalledNotification.timeout(APPLICATION_NOTIFICATION_TIMEOUT_MS, `Could not get the application installed notification within ` + `${APPLICATION_NOTIFICATION_TIMEOUT_MS}ms but we will continue`);
      } catch (e) {
        _logger.default.warn(`Failed to receive the notification. Error: ${e.message}`);
      }
    } finally {
      installationService.close();
      notificationService.close();
    }
  }

  async installApp(...args) {
    return await this.install(...args);
  }

  async isAppInstalled(bundleId) {
    const service = await _appiumIosDevice.services.startInstallationProxyService(this.udid);

    try {
      const applications = await service.lookupApplications({
        bundleIds: bundleId
      });
      return !!applications[bundleId];
    } finally {
      service.close();
    }
  }

  async terminateApp(bundleId) {
    let instrumentService;
    let installProxyService;

    try {
      installProxyService = await _appiumIosDevice.services.startInstallationProxyService(this.udid);
      const apps = await installProxyService.listApplications();

      if (!apps[bundleId]) {
        _logger.default.info(`The bundle id '${bundleId}' did not exist`);

        return false;
      }

      const executableName = apps[bundleId].CFBundleExecutable;

      _logger.default.debug(`The executable name for the bundle id '${bundleId}' was '${executableName}'`);

      instrumentService = await _appiumIosDevice.services.startInstrumentService(this.udid);
      const processes = await instrumentService.callChannel(_appiumIosDevice.INSTRUMENT_CHANNEL.DEVICE_INFO, 'runningProcesses');
      const process = processes.selector.find(process => process.name === executableName);

      if (!process) {
        _logger.default.info(`The process of the bundle id '${bundleId}' was not running`);

        return false;
      }

      await instrumentService.callChannel(_appiumIosDevice.INSTRUMENT_CHANNEL.PROCESS_CONTROL, 'killPid:', `${process.pid}`);
      return true;
    } catch (err) {
      _logger.default.warn(`Failed to kill '${bundleId}'. Original error: ${err.stderr || err.message}`);

      return false;
    } finally {
      if (installProxyService) {
        installProxyService.close();
      }

      if (instrumentService) {
        instrumentService.close();
      }
    }
  }

  async getUserInstalledBundleIdsByBundleName(bundleName) {
    const service = await _appiumIosDevice.services.startInstallationProxyService(this.udid);

    try {
      const applications = await service.listApplications({
        applicationType: 'User'
      });
      return _lodash.default.reduce(applications, (acc, {
        CFBundleName
      }, key) => {
        if (CFBundleName === bundleName) {
          acc.push(key);
        }

        return acc;
      }, []);
    } finally {
      service.close();
    }
  }

  async getPlatformVersion() {
    return await _appiumIosDevice.utilities.getOSVersion(this.udid);
  }

}

var _default = IOSDeploy;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGliL2lvcy1kZXBsb3kuanMiLCJuYW1lcyI6WyJBUFBMSUNBVElPTl9JTlNUQUxMRURfTk9USUZJQ0FUSU9OIiwiSU5TVEFMTEFUSU9OX1NUQUdJTkdfRElSIiwiQVBQTElDQVRJT05fTk9USUZJQ0FUSU9OX1RJTUVPVVRfTVMiLCJJT1NfREVQTE9ZX1RJTUVPVVRfTVMiLCJJT1NfREVQTE9ZIiwiQVBQX0lOU1RBTExfU1RSQVRFR1kiLCJPYmplY3QiLCJmcmVlemUiLCJTRVJJQUwiLCJQQVJBTExFTCIsIklPU0RlcGxveSIsImNvbnN0cnVjdG9yIiwidWRpZCIsInJlbW92ZSIsImJ1bmRsZUlkIiwic2VydmljZSIsInNlcnZpY2VzIiwic3RhcnRJbnN0YWxsYXRpb25Qcm94eVNlcnZpY2UiLCJ1bmluc3RhbGxBcHBsaWNhdGlvbiIsImNsb3NlIiwicmVtb3ZlQXBwIiwiaW5zdGFsbCIsImFwcCIsInRpbWVvdXQiLCJzdHJhdGVneSIsIl8iLCJ2YWx1ZXMiLCJpbmNsdWRlcyIsInRvTG93ZXIiLCJFcnJvciIsImxvZyIsImRlYnVnIiwiaW5zdGFsbFdpdGhJb3NEZXBsb3kiLCJmcyIsIndoaWNoIiwiZXJyIiwiZXhlYyIsInN0ZGVyciIsInN0ZG91dCIsIm1lc3NhZ2UiLCJ0aW1lciIsInRpbWluZyIsIlRpbWVyIiwic3RhcnQiLCJhZmNTZXJ2aWNlIiwic3RhcnRBZmNTZXJ2aWNlIiwiZXh0cmFjdEJ1bmRsZUlkIiwiYnVuZGxlUGF0aE9uUGhvbmUiLCJwYXRoIiwiam9pbiIsInB1c2hGb2xkZXIiLCJ0aW1lb3V0TXMiLCJlbmFibGVQYXJhbGxlbFB1c2giLCJpbnN0YWxsT3JVcGdyYWRlQXBwbGljYXRpb24iLCJpc0FwcEluc3RhbGxlZCIsIndhcm4iLCJCIiwiVGltZW91dEVycm9yIiwiZXJyMSIsImluZm8iLCJnZXREdXJhdGlvbiIsImFzTWlsbGlTZWNvbmRzIiwidG9GaXhlZCIsImlzVXBncmFkZSIsIm5vdGlmaWNhdGlvblNlcnZpY2UiLCJzdGFydE5vdGlmaWNhdGlvblByb3h5U2VydmljZSIsImluc3RhbGxhdGlvblNlcnZpY2UiLCJhcHBJbnN0YWxsZWROb3RpZmljYXRpb24iLCJyZXNvbHZlIiwib2JzZXJ2ZU5vdGlmaWNhdGlvbiIsIm5vdGlmaWNhdGlvbiIsImNsaWVudE9wdGlvbnMiLCJQYWNrYWdlVHlwZSIsInVwZ3JhZGVBcHBsaWNhdGlvbiIsImluc3RhbGxBcHBsaWNhdGlvbiIsImUiLCJpbnN0YWxsQXBwIiwiYXJncyIsImFwcGxpY2F0aW9ucyIsImxvb2t1cEFwcGxpY2F0aW9ucyIsImJ1bmRsZUlkcyIsInRlcm1pbmF0ZUFwcCIsImluc3RydW1lbnRTZXJ2aWNlIiwiaW5zdGFsbFByb3h5U2VydmljZSIsImFwcHMiLCJsaXN0QXBwbGljYXRpb25zIiwiZXhlY3V0YWJsZU5hbWUiLCJDRkJ1bmRsZUV4ZWN1dGFibGUiLCJzdGFydEluc3RydW1lbnRTZXJ2aWNlIiwicHJvY2Vzc2VzIiwiY2FsbENoYW5uZWwiLCJJTlNUUlVNRU5UX0NIQU5ORUwiLCJERVZJQ0VfSU5GTyIsInByb2Nlc3MiLCJzZWxlY3RvciIsImZpbmQiLCJuYW1lIiwiUFJPQ0VTU19DT05UUk9MIiwicGlkIiwiZ2V0VXNlckluc3RhbGxlZEJ1bmRsZUlkc0J5QnVuZGxlTmFtZSIsImJ1bmRsZU5hbWUiLCJhcHBsaWNhdGlvblR5cGUiLCJyZWR1Y2UiLCJhY2MiLCJDRkJ1bmRsZU5hbWUiLCJrZXkiLCJwdXNoIiwiZ2V0UGxhdGZvcm1WZXJzaW9uIiwidXRpbGl0aWVzIiwiZ2V0T1NWZXJzaW9uIl0sInNvdXJjZVJvb3QiOiIuLi8uLiIsInNvdXJjZXMiOlsibGliL2lvcy1kZXBsb3kuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZnMsIHRpbWluZyB9IGZyb20gJ2FwcGl1bS9zdXBwb3J0JztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgc2VydmljZXMsIHV0aWxpdGllcywgSU5TVFJVTUVOVF9DSEFOTkVMIH0gZnJvbSAnYXBwaXVtLWlvcy1kZXZpY2UnO1xuaW1wb3J0IEIgZnJvbSAnYmx1ZWJpcmQnO1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHsgZXhlYyB9IGZyb20gJ3RlZW5fcHJvY2Vzcyc7XG5pbXBvcnQgeyBleHRyYWN0QnVuZGxlSWQgfSBmcm9tICcuL2FwcC11dGlscyc7XG5pbXBvcnQgeyBwdXNoRm9sZGVyIH0gZnJvbSAnLi9pb3MtZnMtaGVscGVycyc7XG5cbmNvbnN0IEFQUExJQ0FUSU9OX0lOU1RBTExFRF9OT1RJRklDQVRJT04gPSAnY29tLmFwcGxlLm1vYmlsZS5hcHBsaWNhdGlvbl9pbnN0YWxsZWQnO1xuY29uc3QgSU5TVEFMTEFUSU9OX1NUQUdJTkdfRElSID0gJ1B1YmxpY1N0YWdpbmcnO1xuY29uc3QgQVBQTElDQVRJT05fTk9USUZJQ0FUSU9OX1RJTUVPVVRfTVMgPSAzMCAqIDEwMDA7XG5jb25zdCBJT1NfREVQTE9ZX1RJTUVPVVRfTVMgPSA0ICogNjAgKiAxMDAwO1xuY29uc3QgSU9TX0RFUExPWSA9ICdpb3MtZGVwbG95JztcbmNvbnN0IEFQUF9JTlNUQUxMX1NUUkFURUdZID0gT2JqZWN0LmZyZWV6ZSh7XG4gIFNFUklBTDogJ3NlcmlhbCcsXG4gIFBBUkFMTEVMOiAncGFyYWxsZWwnLFxuICBJT1NfREVQTE9ZLFxufSk7XG5cblxuY2xhc3MgSU9TRGVwbG95IHtcblxuICBjb25zdHJ1Y3RvciAodWRpZCkge1xuICAgIHRoaXMudWRpZCA9IHVkaWQ7XG4gIH1cblxuICBhc3luYyByZW1vdmUgKGJ1bmRsZUlkKSB7XG4gICAgY29uc3Qgc2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0SW5zdGFsbGF0aW9uUHJveHlTZXJ2aWNlKHRoaXMudWRpZCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHNlcnZpY2UudW5pbnN0YWxsQXBwbGljYXRpb24oYnVuZGxlSWQpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBzZXJ2aWNlLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQXBwIChidW5kbGVJZCkge1xuICAgIGF3YWl0IHRoaXMucmVtb3ZlKGJ1bmRsZUlkKTtcbiAgfVxuXG4gIGFzeW5jIGluc3RhbGwgKGFwcCwgdGltZW91dCwgc3RyYXRlZ3kgPSBudWxsKSB7XG4gICAgaWYgKHN0cmF0ZWd5ICYmICFfLnZhbHVlcyhBUFBfSU5TVEFMTF9TVFJBVEVHWSkuaW5jbHVkZXMoXy50b0xvd2VyKHN0cmF0ZWd5KSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXBwIGluc3RhbGxhdGlvbiBzdHJhdGVneSAnJHtzdHJhdGVneX0nIGlzIHVua25vd24uIGAgK1xuICAgICAgICBgT25seSB0aGUgZm9sbG93aW5nIHN0cmF0ZWdpZXMgYXJlIHN1cHBvcnRlZDogJHtfLnZhbHVlcyhBUFBfSU5TVEFMTF9TVFJBVEVHWSl9YCk7XG4gICAgfVxuICAgIGxvZy5kZWJ1ZyhgVXNpbmcgJyR7c3RyYXRlZ3kgPz8gQVBQX0lOU1RBTExfU1RSQVRFR1kuU0VSSUFMfScgYXBwIGRlcGxveW1lbnQgc3RyYXRlZ3kuIGAgK1xuICAgICAgYFlvdSBjb3VsZCBjaGFuZ2UgaXQgYnkgcHJvdmlkaW5nIGFub3RoZXIgdmFsdWUgdG8gdGhlICdhcHBJbnN0YWxsU3RyYXRlZ3knIGNhcGFiaWxpdHlgKTtcblxuICAgIGNvbnN0IGluc3RhbGxXaXRoSW9zRGVwbG95ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZnMud2hpY2goSU9TX0RFUExPWSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnJHtJT1NfREVQTE9ZfScgdXRpbGl0eSBoYXMgbm90IGJlZW4gZm91bmQgaW4gUEFUSC4gSXMgaXQgaW5zdGFsbGVkP2ApO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZXhlYyhJT1NfREVQTE9ZLCBbXG4gICAgICAgICAgJy0taWQnLCB0aGlzLnVkaWQsXG4gICAgICAgICAgJy0tYnVuZGxlJywgYXBwLFxuICAgICAgICBdLCB7dGltZW91dDogdGltZW91dCA/PyBJT1NfREVQTE9ZX1RJTUVPVVRfTVN9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyLnN0ZGVyciB8fCBlcnIuc3Rkb3V0IHx8IGVyci5tZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgY29uc3QgdGltZXIgPSBuZXcgdGltaW5nLlRpbWVyKCkuc3RhcnQoKTtcbiAgICBpZiAoXy50b0xvd2VyKHN0cmF0ZWd5KSA9PT0gQVBQX0lOU1RBTExfU1RSQVRFR1kuSU9TX0RFUExPWSkge1xuICAgICAgYXdhaXQgaW5zdGFsbFdpdGhJb3NEZXBsb3koKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgYWZjU2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0QWZjU2VydmljZSh0aGlzLnVkaWQpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYnVuZGxlSWQgPSBhd2FpdCBleHRyYWN0QnVuZGxlSWQoYXBwKTtcbiAgICAgICAgY29uc3QgYnVuZGxlUGF0aE9uUGhvbmUgPSBwYXRoLmpvaW4oSU5TVEFMTEFUSU9OX1NUQUdJTkdfRElSLCBidW5kbGVJZCk7XG4gICAgICAgIGF3YWl0IHB1c2hGb2xkZXIoYWZjU2VydmljZSwgYXBwLCBidW5kbGVQYXRoT25QaG9uZSwge1xuICAgICAgICAgIHRpbWVvdXRNczogdGltZW91dCxcbiAgICAgICAgICBlbmFibGVQYXJhbGxlbFB1c2g6IF8udG9Mb3dlcihzdHJhdGVneSkgPT09IEFQUF9JTlNUQUxMX1NUUkFURUdZLlBBUkFMTEVMLFxuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgdGhpcy5pbnN0YWxsT3JVcGdyYWRlQXBwbGljYXRpb24oYnVuZGxlUGF0aE9uUGhvbmUsIGF3YWl0IHRoaXMuaXNBcHBJbnN0YWxsZWQoYnVuZGxlSWQpKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2cud2FybihgRXJyb3IgaW5zdGFsbGluZyBhcHAgJyR7YXBwfSc6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBCLlRpbWVvdXRFcnJvcikge1xuICAgICAgICAgIGxvZy53YXJuKGBDb25zaWRlciBpbmNyZWFzaW5nIHRoZSB2YWx1ZSBvZiAnYXBwUHVzaFRpbWVvdXQnIGNhcGFiaWxpdHlgKTtcbiAgICAgICAgfVxuICAgICAgICBsb2cud2FybihgRmFsbGluZyBiYWNrIHRvICcke0lPU19ERVBMT1l9JyB1c2FnZWApO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbGxXaXRoSW9zRGVwbG95KCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycjEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBpbnN0YWxsICcke2FwcH0nOlxcbmAgK1xuICAgICAgICAgICAgYCAgLSAke2Vyci5tZXNzYWdlfVxcbmAgK1xuICAgICAgICAgICAgYCAgLSAke2VycjEubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYWZjU2VydmljZS5jbG9zZSgpO1xuICAgICAgfVxuICAgIH1cbiAgICBsb2cuaW5mbyhgQXBwIGluc3RhbGxhdGlvbiBzdWNjZWVkZWQgYWZ0ZXIgJHt0aW1lci5nZXREdXJhdGlvbigpLmFzTWlsbGlTZWNvbmRzLnRvRml4ZWQoMCl9bXNgKTtcbiAgfVxuXG4gIGFzeW5jIGluc3RhbGxPclVwZ3JhZGVBcHBsaWNhdGlvbiAoYnVuZGxlUGF0aE9uUGhvbmUsIGlzVXBncmFkZSA9IGZhbHNlKSB7XG4gICAgY29uc3Qgbm90aWZpY2F0aW9uU2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0Tm90aWZpY2F0aW9uUHJveHlTZXJ2aWNlKHRoaXMudWRpZCk7XG4gICAgY29uc3QgaW5zdGFsbGF0aW9uU2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0SW5zdGFsbGF0aW9uUHJveHlTZXJ2aWNlKHRoaXMudWRpZCk7XG4gICAgY29uc3QgYXBwSW5zdGFsbGVkTm90aWZpY2F0aW9uID0gbmV3IEIoKHJlc29sdmUpID0+IHtcbiAgICAgIG5vdGlmaWNhdGlvblNlcnZpY2Uub2JzZXJ2ZU5vdGlmaWNhdGlvbihBUFBMSUNBVElPTl9JTlNUQUxMRURfTk9USUZJQ0FUSU9OLCB7XG4gICAgICAgIG5vdGlmaWNhdGlvbjogcmVzb2x2ZVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgY29uc3QgY2xpZW50T3B0aW9ucyA9IHtQYWNrYWdlVHlwZTogJ0RldmVsb3Blcid9O1xuICAgIHRyeSB7XG4gICAgICBpZiAoaXNVcGdyYWRlKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhgQW4gdXBncmFkZSBvZiB0aGUgZXhpc3RpbmcgYXBwbGljYXRpb24gaXMgZ29pbmcgdG8gYmUgcGVyZm9ybWVkYCk7XG4gICAgICAgIGF3YWl0IGluc3RhbGxhdGlvblNlcnZpY2UudXBncmFkZUFwcGxpY2F0aW9uKGJ1bmRsZVBhdGhPblBob25lLCBjbGllbnRPcHRpb25zKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhgQSBuZXcgYXBwbGljYXRpb24gaW5zdGFsbGF0aW9uIGlzIGdvaW5nIHRvIGJlIHBlcmZvcm1lZGApO1xuICAgICAgICBhd2FpdCBpbnN0YWxsYXRpb25TZXJ2aWNlLmluc3RhbGxBcHBsaWNhdGlvbihidW5kbGVQYXRoT25QaG9uZSwgY2xpZW50T3B0aW9ucyk7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBhcHBJbnN0YWxsZWROb3RpZmljYXRpb24udGltZW91dChBUFBMSUNBVElPTl9OT1RJRklDQVRJT05fVElNRU9VVF9NUyxcbiAgICAgICAgICBgQ291bGQgbm90IGdldCB0aGUgYXBwbGljYXRpb24gaW5zdGFsbGVkIG5vdGlmaWNhdGlvbiB3aXRoaW4gYCArXG4gICAgICAgICAgYCR7QVBQTElDQVRJT05fTk9USUZJQ0FUSU9OX1RJTUVPVVRfTVN9bXMgYnV0IHdlIHdpbGwgY29udGludWVgKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbG9nLndhcm4oYEZhaWxlZCB0byByZWNlaXZlIHRoZSBub3RpZmljYXRpb24uIEVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgaW5zdGFsbGF0aW9uU2VydmljZS5jbG9zZSgpO1xuICAgICAgbm90aWZpY2F0aW9uU2VydmljZS5jbG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGluc3RhbGxBcHAgKC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5pbnN0YWxsKC4uLmFyZ3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiBhbiBhcHBsaWNhdGlvbiBvYmplY3QgaWYgdGVzdCBhcHAgaGFzICdidW5kbGVpZCcuXG4gICAqIFRoZSB0YXJnZXQgYnVuZGxlaWQgY2FuIGJlIFVzZXIgYW5kIFN5c3RlbSBhcHBzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYnVuZGxlSWQgVGhlIGJ1bmRsZUlkIHRvIGVuc3VyZSBpdCBpcyBpbnN0YWxsZWRcbiAgICogQHJldHVybiB7Ym9vbGVhbn0gUmV0dXJucyBUcnVlIGlmIHRoZSBidW5kbGVpZCBleGlzdHMgaW4gdGhlIHJlc3VsdCBvZiAnbGlzdEFwcGxpY2F0aW9ucycgbGlrZTpcbiAgICogeyBcImNvbS5hcHBsZS5QcmVmZXJlbmNlc1wiOntcbiAgICogICBcIlVJUmVxdWlyZWREZXZpY2VDYXBhYmlsaXRpZXNcIjpbXCJhcm02NFwiXSxcbiAgICogICBcIlVJUmVxdWlyZXNGdWxsU2NyZWVuXCI6dHJ1ZSxcbiAgICogICBcIkNGQnVuZGxlSW5mb0RpY3Rpb25hcnlWZXJzaW9uXCI6XCI2LjBcIixcbiAgICogICBcIkVudGl0bGVtZW50c1wiOlxuICAgKiAgICAge1wiY29tLmFwcGxlLmZyb250Ym9hcmQuZGVsZXRlLWFwcGxpY2F0aW9uLXNuYXBzaG90c1wiOnRydWUsLi5cbiAgICovXG4gIGFzeW5jIGlzQXBwSW5zdGFsbGVkIChidW5kbGVJZCkge1xuICAgIGNvbnN0IHNlcnZpY2UgPSBhd2FpdCBzZXJ2aWNlcy5zdGFydEluc3RhbGxhdGlvblByb3h5U2VydmljZSh0aGlzLnVkaWQpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhcHBsaWNhdGlvbnMgPSBhd2FpdCBzZXJ2aWNlLmxvb2t1cEFwcGxpY2F0aW9ucyh7IGJ1bmRsZUlkczogYnVuZGxlSWQgfSk7XG4gICAgICByZXR1cm4gISFhcHBsaWNhdGlvbnNbYnVuZGxlSWRdO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBzZXJ2aWNlLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdGVybWluYXRlQXBwIChidW5kbGVJZCkge1xuICAgIGxldCBpbnN0cnVtZW50U2VydmljZTtcbiAgICBsZXQgaW5zdGFsbFByb3h5U2VydmljZTtcbiAgICB0cnkge1xuICAgICAgaW5zdGFsbFByb3h5U2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0SW5zdGFsbGF0aW9uUHJveHlTZXJ2aWNlKHRoaXMudWRpZCk7XG4gICAgICBjb25zdCBhcHBzID0gYXdhaXQgaW5zdGFsbFByb3h5U2VydmljZS5saXN0QXBwbGljYXRpb25zKCk7XG4gICAgICBpZiAoIWFwcHNbYnVuZGxlSWRdKSB7XG4gICAgICAgIGxvZy5pbmZvKGBUaGUgYnVuZGxlIGlkICcke2J1bmRsZUlkfScgZGlkIG5vdCBleGlzdGApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb25zdCBleGVjdXRhYmxlTmFtZSA9IGFwcHNbYnVuZGxlSWRdLkNGQnVuZGxlRXhlY3V0YWJsZTtcbiAgICAgIGxvZy5kZWJ1ZyhgVGhlIGV4ZWN1dGFibGUgbmFtZSBmb3IgdGhlIGJ1bmRsZSBpZCAnJHtidW5kbGVJZH0nIHdhcyAnJHtleGVjdXRhYmxlTmFtZX0nYCk7XG4gICAgICBpbnN0cnVtZW50U2VydmljZSA9IGF3YWl0IHNlcnZpY2VzLnN0YXJ0SW5zdHJ1bWVudFNlcnZpY2UodGhpcy51ZGlkKTtcbiAgICAgIGNvbnN0IHByb2Nlc3NlcyA9IGF3YWl0IGluc3RydW1lbnRTZXJ2aWNlLmNhbGxDaGFubmVsKElOU1RSVU1FTlRfQ0hBTk5FTC5ERVZJQ0VfSU5GTywgJ3J1bm5pbmdQcm9jZXNzZXMnKTtcbiAgICAgIGNvbnN0IHByb2Nlc3MgPSBwcm9jZXNzZXMuc2VsZWN0b3IuZmluZCgocHJvY2VzcykgPT4gcHJvY2Vzcy5uYW1lID09PSBleGVjdXRhYmxlTmFtZSk7XG4gICAgICBpZiAoIXByb2Nlc3MpIHtcbiAgICAgICAgbG9nLmluZm8oYFRoZSBwcm9jZXNzIG9mIHRoZSBidW5kbGUgaWQgJyR7YnVuZGxlSWR9JyB3YXMgbm90IHJ1bm5pbmdgKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgYXdhaXQgaW5zdHJ1bWVudFNlcnZpY2UuY2FsbENoYW5uZWwoSU5TVFJVTUVOVF9DSEFOTkVMLlBST0NFU1NfQ09OVFJPTCwgJ2tpbGxQaWQ6JywgYCR7cHJvY2Vzcy5waWR9YCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxvZy53YXJuKGBGYWlsZWQgdG8ga2lsbCAnJHtidW5kbGVJZH0nLiBPcmlnaW5hbCBlcnJvcjogJHtlcnIuc3RkZXJyIHx8IGVyci5tZXNzYWdlfWApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAoaW5zdGFsbFByb3h5U2VydmljZSkge1xuICAgICAgICBpbnN0YWxsUHJveHlTZXJ2aWNlLmNsb3NlKCk7XG4gICAgICB9XG4gICAgICBpZiAoaW5zdHJ1bWVudFNlcnZpY2UpIHtcbiAgICAgICAgaW5zdHJ1bWVudFNlcnZpY2UuY2xvc2UoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIHtzdHJpbmd9IGJ1bmRsZU5hbWUgVGhlIG5hbWUgb2YgQ0ZCdW5kbGVOYW1lIGluIEluZm8ucGxpc3RcbiAgICpcbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEEgbGlzdCBvZiBVc2VyIGxldmVsIGFwcHMnIGJ1bmRsZSBpZHMgd2hpY2ggaGFzXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAnQ0ZCdW5kbGVOYW1lJyBhdHRyaWJ1dGUgYXMgJ2J1bmRsZU5hbWUnLlxuICAgKi9cbiAgYXN5bmMgZ2V0VXNlckluc3RhbGxlZEJ1bmRsZUlkc0J5QnVuZGxlTmFtZSAoYnVuZGxlTmFtZSkge1xuICAgIGNvbnN0IHNlcnZpY2UgPSBhd2FpdCBzZXJ2aWNlcy5zdGFydEluc3RhbGxhdGlvblByb3h5U2VydmljZSh0aGlzLnVkaWQpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhcHBsaWNhdGlvbnMgPSBhd2FpdCBzZXJ2aWNlLmxpc3RBcHBsaWNhdGlvbnMoe2FwcGxpY2F0aW9uVHlwZTogJ1VzZXInfSk7XG4gICAgICByZXR1cm4gXy5yZWR1Y2UoYXBwbGljYXRpb25zLCAoYWNjLCB7Q0ZCdW5kbGVOYW1lfSwga2V5KSA9PiB7XG4gICAgICAgIGlmIChDRkJ1bmRsZU5hbWUgPT09IGJ1bmRsZU5hbWUpIHtcbiAgICAgICAgICBhY2MucHVzaChrZXkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgICB9LCBbXSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHNlcnZpY2UuY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRQbGF0Zm9ybVZlcnNpb24gKCkge1xuICAgIHJldHVybiBhd2FpdCB1dGlsaXRpZXMuZ2V0T1NWZXJzaW9uKHRoaXMudWRpZCk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgSU9TRGVwbG95O1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLGtDQUFrQyxHQUFH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
