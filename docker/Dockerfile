FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-gdal \
    python3-rtree \
    gdal-bin \
    libgdal-dev \
    libspatialindex-dev \
    unar \
    unzip \
    bc \
    wget \
 && rm -rf /var/lib/apt/lists/*

ADD ./requirements.txt .
RUN grep -v -E '^(GDAL|rtree)=' requirements.txt > /tmp/requirements-docker.txt \
 && python3 -m pip install -r /tmp/requirements-docker.txt

RUN mkdir /code
ADD . /code/

WORKDIR /code
CMD python3 server.py

EXPOSE 8080
EXPOSE 8443
