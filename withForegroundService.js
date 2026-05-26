const { withAndroidManifest } = require('@expo/config-plugins');

const FG_SERVICES = [
  'com.supersami.foregroundservice.ForegroundService',
  'com.supersami.foregroundservice.ForegroundServiceTask',
];

module.exports = function withForegroundService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application[0];

    if (!application.service) {
      application.service = [];
    }

    for (const serviceName of FG_SERVICES) {
      const exists = application.service.some(
        (s) => s.$['android:name'] === serviceName,
      );
      if (!exists) {
        application.service.push({
          $: {
            'android:name': serviceName,
            'android:foregroundServiceType': 'dataSync',
            'android:exported': 'false',
          },
        });
      }
    }

    if (!application['meta-data']) {
      application['meta-data'] = [];
    }
    const hasMetaData = application['meta-data'].some(
      (m) => m.$['android:name'] === 'com.supersami.foregroundservice.notification_channel_name',
    );
    if (!hasMetaData) {
      application['meta-data'].push({
        $: {
          'android:name': 'com.supersami.foregroundservice.notification_channel_name',
          'android:value': 'Relais Boutididact',
        },
      });
      application['meta-data'].push({
        $: {
          'android:name': 'com.supersami.foregroundservice.notification_channel_description',
          'android:value': 'Maintient le relais actif en arriere-plan.',
        },
      });
      application['meta-data'].push({
        $: {
          'android:name': 'com.supersami.foregroundservice.notification_color',
          'android:resource': '@color/colorPrimary',
        },
      });
    }

    return config;
  });
};
