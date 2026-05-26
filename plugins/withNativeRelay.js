const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');

const PKG = 'com.boutididact.print.relay';
const SERVICE = `${PKG}.RelayForegroundService`;
const JAVA_SRC = path.join(__dirname, 'native-relay', 'android');
const JAVA_DEST = ['app', 'src', 'main', 'java', 'com', 'boutididact', 'print', 'relay'];

function copyJavaSources(projectRoot, platformRoot) {
  const destDir = path.join(platformRoot, ...JAVA_DEST);
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(JAVA_SRC)) {
    if (!file.endsWith('.java')) continue;
    fs.copyFileSync(
      path.join(JAVA_SRC, file),
      path.join(destDir, file),
    );
  }
}

function withNativeRelayManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application[0];
    if (!application.service) application.service = [];

    const exists = application.service.some(
      (s) => s.$['android:name'] === SERVICE,
    );
    if (!exists) {
      application.service.push({
        $: {
          'android:name': SERVICE,
          'android:enabled': 'true',
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
          'android:stopWithTask': 'false',
        },
      });
    }

    const bootReceiver = `${PKG}.BootReceiver`;
    if (!application.receiver) application.receiver = [];
    const bootExists = application.receiver.some(
      (r) => r.$['android:name'] === bootReceiver,
    );
    if (!bootExists) {
      application.receiver.push({
        $: {
          'android:name': bootReceiver,
          'android:enabled': 'true',
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }],
          },
        ],
      });
    }

    if (!manifest.manifest['uses-permission']) {
      manifest.manifest['uses-permission'] = [];
    }
    const perms = manifest.manifest['uses-permission'];
    const bootPerm = 'android.permission.RECEIVE_BOOT_COMPLETED';
    if (!perms.some((p) => p.$['android:name'] === bootPerm)) {
      perms.push({ $: { 'android:name': bootPerm } });
    }

    return config;
  });
}

function withNativeRelayGradle(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes('okhttp3')) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")`,
      );
    }
    config.modResults.contents = contents;
    return config;
  });
}

function withNativeRelayMainApplication(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes('RelayPackage')) {
      return config;
    }

    if (contents.includes('packages.apply')) {
      contents = contents.replace(
        /packages\.apply\s*\{([^}]*)\}/,
        (match, inner) => {
          if (inner.includes('RelayPackage')) return match;
          return `packages.apply {${inner}
              add(RelayPackage())
            }`;
        },
      );
    } else if (contents.includes('PackageList(this).packages')) {
      contents = contents.replace(
        /PackageList\(this\)\.packages(\.apply\s*\{)?/,
        (m) => `${m}
              add(RelayPackage())`,
      );
    }

    if (!contents.includes(`import ${PKG}.RelayPackage`)) {
      contents = contents.replace(
        /package\s+[\w.]+/,
        (m) => `${m}\n\nimport ${PKG}.RelayPackage`,
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withNativeRelay(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      copyJavaSources(
        config.modRequest.projectRoot,
        config.modRequest.platformProjectRoot,
      );
      return config;
    },
  ]);
  config = withNativeRelayManifest(config);
  config = withNativeRelayGradle(config);
  config = withNativeRelayMainApplication(config);
  return config;
};
