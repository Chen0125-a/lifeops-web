#!/bin/sh
set -eu

mkdir -p \
  /tmp/nginx/client \
  /tmp/nginx/proxy \
  /tmp/nginx/fastcgi \
  /tmp/nginx/uwsgi \
  /tmp/nginx/scgi

exec nginx -g 'daemon off;'

