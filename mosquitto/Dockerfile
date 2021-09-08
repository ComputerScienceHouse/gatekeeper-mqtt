FROM docker.io/eclipse-mosquitto

RUN chown -R mosquitto:mosquitto /mosquitto && \
  chmod -R g+rwx /mosquitto && \
  mkdir /mosquitto/secrets && \
  chmod -R 445 /mosquitto/config /mosquitto/secrets

COPY gk-entrypoint.sh /gk-entrypoint.sh
COPY mosquitto.conf /mosquitto/config/mosquitto.conf

ENTRYPOINT ["/gk-entrypoint.sh"]
CMD ["/usr/sbin/mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]
