FROM postgres:18.6-bookworm AS pg-bigm-builder

ARG PG_BIGM_VERSION=1.2-20250903
ARG PG_BIGM_SHA256=4d4fb48161e3f9e99207851299379c83b3e5d1d3c1a07c35f6a3153d577b3142

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates curl postgresql-server-dev-18 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN curl --fail --location --silent --show-error \
      "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" \
      --output pg_bigm.tar.gz \
  && echo "${PG_BIGM_SHA256}  pg_bigm.tar.gz" | sha256sum --check --strict \
  && tar --extract --gzip --file pg_bigm.tar.gz --strip-components=1 \
  && make USE_PGXS=1 \
  && make USE_PGXS=1 install DESTDIR=/extension

FROM postgres:18.6-bookworm
COPY --from=pg-bigm-builder /extension/ /

CMD ["postgres", "-c", "shared_preload_libraries=pg_bigm"]

