@echo off
set ELECTRON_RUN_AS_NODE=
title Cluely Stealth Meeting Assistant - Dev Preview
echo ========================================================
echo   Launching Cluely Stealth Meeting Assistant (Preview)
echo   OS Stealth Flag: WDA_EXCLUDEFROMCAPTURE Active
echo   Audio Channels: Ch 0 (Mic) + Ch 1 (WASAPI Loopback)
echo   Hotkeys:
echo     Ctrl + Enter       : Trigger AI Assist
echo     Ctrl + \           : Stealth Panic Hide / Show
echo     Ctrl + Shift + T   : Toggle Pre-Compilation Test Matrix
echo ========================================================
npm start
