#!/usr/bin/env bash
# API-Smoketest für Campus News —   bash cn-api-test.sh   (Server muss laufen)
set -u
B=${B:-http://127.0.0.1:3000}
J=/tmp/cn-cookies.txt
rm -f "$J"
pass=0; fail=0
chk() { # chk "name" "expected" "actual"
  if [ "$2" = "$3" ]; then echo "  ok   $1 ($3)"; pass=$((pass+1));
  else echo "  FAIL $1 — erwartet [$2], bekommen [$3]"; fail=$((fail+1)); fi
}
code() { curl -s -o /tmp/cn-body -w '%{http_code}' "$@"; }
json() { node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('/tmp/cn-body','utf8'));console.log($1)"; }

echo "1) Öffentlich"
chk "health" 200 "$(code $B/api/health)"
chk "setup-state braucht Setup" '{"needsSetup":true}' "$(curl -s $B/api/setup-state)"
chk "12 Demo-Artikel" 12 "$(curl -s $B/api/articles | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).articles.length))')"
chk "admin-Seite erreichbar" 200 "$(code $B/admin/)"
chk "Startseite erreichbar" 200 "$(code $B/)"
chk "/admin leitet um" 302 "$(code $B/admin)"
chk "unbekannter Pfad 404" 404 "$(code $B/gibtesnicht)"

echo "2) Setup-Regeln"
chk "zu kurzes Passwort abgelehnt" 400 "$(code -X POST -H 'Content-Type: application/json' -d '{"username":"redaktion","password":"kurz"}' $B/api/setup)"
chk "geläufiges Passwort abgelehnt" 400 "$(code -X POST -H 'Content-Type: application/json' -d '{"username":"redaktion","password":"passwort123"}' $B/api/setup)"
chk "Benutzername mit Leerzeichen abgelehnt" 400 "$(code -X POST -H 'Content-Type: application/json' -d '{"username":"re dak","password":"RoteTafel!2026"}' $B/api/setup)"
chk "Setup erfolgreich" 201 "$(code -c $J -X POST -H 'Content-Type: application/json' -d '{"username":"redaktion","password":"RoteTafel!2026"}' $B/api/setup)"
chk "zweites Setup blockiert" 409 "$(code -X POST -H 'Content-Type: application/json' -d '{"username":"root","password":"RoteTafel!2026"}' $B/api/setup)"
chk "jetzt angemeldet" "redaktion" "$(curl -s -b $J $B/api/auth/me | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).user.username))')"

echo "3) CSRF / Auth-Grenzen"
chk "fremde Origin abgelehnt" 403 "$(code -b $J -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' $B/api/admin/articles)"
chk "Admin-API ohne Cookie: 401" 401 "$(code $B/api/admin/articles)"
chk "Upload ohne Cookie: 401" 401 "$(code -X POST -H 'Content-Type: image/png' --data-binary @/dev/null $B/api/admin/uploads)"
chk "Session überlebt CSRF-Ablehnung" 200 "$(code -b $J $B/api/admin/articles)"

echo "4) Artikel: Entwurf -> Veröffentlichung"
chk "Entwurf angelegt" 201 "$(code -b $J -X POST -H 'Content-Type: application/json' -d '{"title":"Testartikel aus dem API-Smoketest","teaser":"Wird gleich wieder gelöscht.","body":"Erster Absatz.\n\nZweiter Absatz.","category":"technik","date":"2026-09-18","author":"Test","tags":"test, api","status":"draft"}' $B/api/admin/articles)"
ID=$(json 'd.article.id')
chk "Entwurf nicht öffentlich" 404 "$(code $B/api/articles/testartikel-aus-dem-api-smoketest)"
chk "Validierung: kurzer Titel" 400 "$(code -b $J -X POST -H 'Content-Type: application/json' -d '{"title":"ab","teaser":"x","body":"y","category":"technik","date":"2026-09-18"}' $B/api/admin/articles)"
chk "Validierung: falsches Ressort" 400 "$(code -b $J -X POST -H 'Content-Type: application/json' -d '{"title":"Gültiger Titel","teaser":"x","body":"y","category":"quatsch","date":"2026-09-18"}' $B/api/admin/articles)"
chk "Validierung: kaputtes Datum" 400 "$(code -b $J -X POST -H 'Content-Type: application/json' -d '{"title":"Gültiger Titel","teaser":"x","body":"y","category":"technik","date":"18.09.2026"}' $B/api/admin/articles)"
chk "Validierung: fehlender Teaser" 400 "$(code -b $J -X POST -H 'Content-Type: application/json' -d '{"title":"Gültiger Titel","teaser":"","body":"y","category":"technik","date":"2026-09-18"}' $B/api/admin/articles)"
chk "veröffentlichen (PUT)" 200 "$(code -b $J -X PUT -H 'Content-Type: application/json' -d '{"status":"published"}' $B/api/admin/articles/$ID)"
chk "jetzt öffentlich sichtbar" 200 "$(code $B/api/articles/testartikel-aus-dem-api-smoketest)"
chk "Absätze korrekt getrennt" 2 "$(curl -s $B/api/articles/testartikel-aus-dem-api-smoketest | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).article.body.length))')"
chk "Lesezeit automatisch berechnet" 1 "$(curl -s $B/api/articles/testartikel-aus-dem-api-smoketest | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).article.readingMinutes))')"
chk "Slug-Kollision wird umgangen" 201 "$(code -b $J -X POST -H 'Content-Type: application/json' -d '{"title":"Testartikel aus dem API-Smoketest","teaser":"gleicher Titel","body":"x","category":"technik","date":"2026-09-18","status":"draft"}' $B/api/admin/articles)"
chk "zweiter Slug mit Suffix" "testartikel-aus-dem-api-smoketest-2" "$(json 'd.article.slug')"
ID2=$(json 'd.article.id')

echo "5) Upload"
node -e 'const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");require("fs").writeFileSync("/tmp/cn-pixel.png",b)'
node -e 'require("fs").writeFileSync("/tmp/cn-fake.png","Das ist kein Bild, sondern Text mit ausreichender Laenge fuer den Magic-Byte-Test.")'
chk "PNG-Upload ok" 201 "$(code -b $J -X POST -H 'Content-Type: image/png' --data-binary @/tmp/cn-pixel.png $B/api/admin/uploads)"
IMG=$(json 'd.url')
chk "Bild wird ausgeliefert" 200 "$(code $B$IMG)"
chk "Text als PNG abgelehnt" 415 "$(code -b $J -X POST -H 'Content-Type: image/png' --data-binary @/tmp/cn-fake.png $B/api/admin/uploads)"
chk "leere Datei abgelehnt" 400 "$(code -b $J -X POST -H 'Content-Type: image/png' --data-binary @/dev/null $B/api/admin/uploads)"
chk "PDF abgelehnt" 415 "$(code -b $J -X POST -H 'Content-Type: application/pdf' --data-binary @/tmp/cn-pixel.png $B/api/admin/uploads)"
chk "Bild in Artikel speichern" 200 "$(code -b $J -X PUT -H 'Content-Type: application/json' -d "{\"image\":\"$IMG\"}" $B/api/admin/articles/$ID)"
chk "Bild im öffentlichen Artikel" "$IMG" "$(curl -s $B/api/articles/testartikel-aus-dem-api-smoketest | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).article.image))')"
chk "Traversal in /uploads blockiert" 404 "$(code --path-as-is $B/uploads/../../etc/passwd)"
chk "Traversal in /assets blockiert" 404 "$(code --path-as-is $B/assets/../../server/db.js)"
chk "Servercode nicht ausgeliefert" 404 "$(code $B/server/db.js)"
chk "DB nicht ausgeliefert" 404 "$(code $B/data/campusnews.db)"

echo "6) Passwort ändern"
chk "falsches Alt-Passwort abgelehnt" 400 "$(code -b $J -X POST -H 'Content-Type: application/json' -d '{"currentPassword":"falschfalsch","nextPassword":"BlaueTafel!99"}' $B/api/auth/password)"
chk "zu kurzes neues Passwort abgelehnt" 400 "$(code -b $J -X POST -H 'Content-Type: application/json' -d '{"currentPassword":"RoteTafel!2026","nextPassword":"kurz"}' $B/api/auth/password)"
chk "Passwortwechsel ok" 200 "$(code -b $J -c $J -X POST -H 'Content-Type: application/json' -d '{"currentPassword":"RoteTafel!2026","nextPassword":"BlaueTafel!99"}' $B/api/auth/password)"
chk "neues Passwort funktioniert" 200 "$(code -c /tmp/cn-jar-new.txt -X POST -H 'Content-Type: application/json' -d '{"username":"redaktion","password":"BlaueTafel!99"}' $B/api/auth/login)"
chk "altes Passwort funktioniert nicht" 401 "$(code -X POST -H 'Content-Type: application/json' -d '{"username":"redaktion","password":"RoteTafel!2026"}' $B/api/auth/login)"

echo "7) Login-Bremse"
for i in 1 2 3 4 5 6; do code -X POST -H 'Content-Type: application/json' -d '{"username":"redaktion","password":"falschfalsch"}' $B/api/auth/login >/dev/null; done
chk "nach 6 Fehlversuchen gesperrt" 429 "$(code -X POST -H 'Content-Type: application/json' -d '{"username":"redaktion","password":"falschfalsch"}' $B/api/auth/login)"
chk "richtiges Passwort auch gesperrt" 429 "$(code -X POST -H 'Content-Type: application/json' -d '{"username":"redaktion","password":"BlaueTafel!99"}' $B/api/auth/login)"

echo "8) Aufräumen"
chk "Artikel gelöscht" 200 "$(code -b $J -X DELETE $B/api/admin/articles/$ID)"
chk "zweiter Artikel gelöscht" 200 "$(code -b $J -X DELETE $B/api/admin/articles/$ID2)"
chk "Logout" 200 "$(code -b $J -X POST $B/api/auth/logout)"
chk "nach Logout 401" 401 "$(code -b $J $B/api/admin/articles)"

echo
echo "Ergebnis: $pass ok, $fail fehlgeschlagen"
[ "$fail" -eq 0 ]
