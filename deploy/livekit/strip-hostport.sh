#!/bin/bash
# Helm post-renderer: chart 1.9.0 always emits hostPort for rtc ports; we want pod-IP only.
exec sed '/^ *hostPort: /d'
