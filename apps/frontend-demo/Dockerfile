FROM registry.sberdevices.ru/rndml/devops/dockerfiles/nginx-alpine:1.29.5

WORKDIR /usr/share/nginx/html

# dist/ собирается в CI-джобе до docker build
ARG DIST=dist
COPY ./apps/frontend-demo/${DIST}/ /usr/share/nginx/html

COPY ./apps/frontend-demo/nginx.conf /etc/nginx/conf.d/default.conf
