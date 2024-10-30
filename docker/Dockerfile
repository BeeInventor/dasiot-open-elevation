FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-gdal \
    gdal-bin \
    libgdal-dev \
    libspatialindex-dev \
    unar \
    bc \
    wget

ADD ./requirements.txt .
RUN pip install -r requirements.txt

RUN mkdir /code
ADD . /code/

WORKDIR /code
CMD python3 server.py

EXPOSE 8080
EXPOSE 8443