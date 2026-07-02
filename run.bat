@echo off
cd /d "%~dp0"
node --env-file=.env index.js >> bot.log 2>&1
