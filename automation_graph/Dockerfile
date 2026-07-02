ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache python3 py3-pip

WORKDIR /app
COPY app/requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /app/requirements.txt

COPY app/ /app/

ENV PYTHONUNBUFFERED=1
EXPOSE 8099

# La base HA (home-assistant/{arch}-base) demarre s6-overlay comme ENTRYPOINT ;
# comme cet add-on n'a besoin que d'un seul process (pas de supervision s6),
# on vide l'ENTRYPOINT herite pour que python3 tourne directement en PID 1.
# Sans cette ligne : "s6-overlay-suexec: fatal: can only run as pid 1".
ENTRYPOINT []
CMD ["python3", "/app/server.py"]
