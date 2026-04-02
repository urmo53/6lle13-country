# ÕLLE 13 Country

## Käivitamine
```bash
npm install
npm start
```

Ava:
```bash
http://localhost:3000
```

## Mis sees on
- suur pealkiri ÕLLE 13 Country
- 2 tulpa, kumbki 450px
- vasakul suur pilt hetkel mängiva loo järgi
- pildi otsing Apple Musicust, seejärel Deezerist
- kui pilti ei leita, kasutatakse `public/pilt.png`
- paremal loo nimi, artist, play/stop nupp ja 5 tulbaga visuaal
- all eelmise loo nimi ja 110px cover

## Märkus
Artwork otsing tehakse serveri poolel. Kui välised teenused ei anna tulemust, näidatakse kohaliku fallback-pildina `pilt.png`.