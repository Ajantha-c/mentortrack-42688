#!/bin/bash
cd /home/kavia/workspace/code-generation/mentortrack-42688/t3_log_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

