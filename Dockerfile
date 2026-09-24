FROM alpine:3.20

# Keep identical to the default $Version in tools/get-pocketbase.ps1.
ARG PB_VERSION=0.35.0
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip -d /pb \
 && rm /tmp/pb.zip

COPY pb_migrations /pb/pb_migrations
COPY index.html manifest.webmanifest sw.js /pb/pb_public/
COPY css /pb/pb_public/css
COPY js /pb/pb_public/js
COPY icons /pb/pb_public/icons

EXPOSE 8090

# --automigrate=false: schema changes come only from committed migrations,
# never from dashboard edits writing files into the (throwaway) container.
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--publicDir=/pb/pb_public", "--migrationsDir=/pb/pb_migrations", "--automigrate=false"]
