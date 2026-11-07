# The load stand's fleet, built from apps/node. Same toolchain as the agent.
FROM golang:1.27.3-alpine AS builder
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/synth-agent ./cmd/synth-agent

FROM alpine:3.22
COPY --from=builder /out/synth-agent /usr/local/bin/synth-agent
ENTRYPOINT ["/usr/local/bin/synth-agent"]
