#!/bin/sh

touch /tmp/mqtt_passwd
mosquitto_passwd -b /tmp/mqtt_passwd "$GK_MQTT_USERNAME" "$GK_MQTT_PASSWORD"

# TODO: Door creds!
# mosquitto_passwd -b /mosquitto/config/passwd "$GK_MQTT_USERNAME" "$GK_MQTT_PASSWORD"

# Start up Mosquitto!
echo "Mosquitto data:"
ls /mosquitto /mosquitto/config -la
echo "Running:"
echo "$@"
/docker-entrypoint.sh "$@"
echo "Exited with: $?"
