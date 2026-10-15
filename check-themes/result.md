# Проверка Android-сборки: 9 из 11

- ✅ debug .apk installs
- ✅ player interface is up
- ✅ page knows it is on Android — `{"cls":"phone android","theme":"p5","back":"function","ms":"function","platform":"android","st":"max(0px,0px)","sat":"0px","w":412,"h":842,"ua":"Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UE1A.230829.050; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.5672.136 Mob`
- ✅ catalog of tracks — `{"tracks":201}`
- ✅ music plays from Google Drive — `{"opened":true,"tapped":true,"t":3.999637,"d":277.86449,"paused":false,"src":"https://localhost/_capacitor_file_/data/user/0/com.tornoment.personafy/cache/stream/1OSygKSsUJGVViYcdlX9otpvaktpsZI5p.mp3","err":null,"view":"search","title":"Wake Up, Get Up, Get Out There"}`
- ✅ track is served from the app's cache — `"https://localhost/_capacitor_file_/data/user/0/com.tornoment.personafy/cache/stream/1OSygKSsUJGVViYcdlX9otpvaktpsZI5p.mp3"`
- ✅ volume levelling (Web Audio) is running — `{"level":true,"contexts":"running"}`
- ✅ sound goes out of the phone — `{"started":true,"players":["state:started"]}`
- ❌ theme tour: p3r — `"no page in the web view"`
- ❌ check script ran to the end — `"Error: no page in the web view\n    at connectPage (file:///home/runner/work/Personafy/Personafy/mobile/scripts/android-check.mjs:100:20)\n    at async connect (file:///home/runner/work/Personafy/Personafy/mobile/scripts/android-check.mjs:139:9)\n    at async run (file:///home/runner/work/Personafy`
- ✅ no script errors on the page — `[]`
