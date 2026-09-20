# 11-B sinf fondi

25 ta takrorsiz o‘quvchi, sentyabrdan maygacha 9 oylik fond jadvali. Barcha to‘lovlar avval **To‘lanmagan** holatida boshlanadi. Haqiqiy to‘lovlarni admin belgilaydi.

## Ishga tushirish

Node.js **22.13 yoki yangiroq** versiyasi kerak. Qo‘shimcha paket o‘rnatish shart emas.

```sh
npm start
```

Brauzerda **http://localhost:3000** manzilini oching. Ishlab chiqish uchun `npm run dev` serverni fayllar o‘zgarganida qayta ishga tushiradi.

## Faqat siz boshqarishingiz uchun

1. Birinchi ishga tushirishda tasodifiy admin paroli `.data/admin-password.txt` fayliga yoziladi. Faylni kompyuteringizdagi muharrirda oching.
2. Saytdagi **Admin kirish** tugmasiga bosing va shu parolni kiriting.
3. **Admin hisobi → Parolni almashtirish** orqali o‘zingizga parol qo‘ying. Kamida 12 belgi kerak. Boshlang‘ich parol fayli shundan so‘ng avtomatik o‘chiriladi.

Mehmonlar jadvalni ko‘ra oladi, ammo to‘lovlarni o‘zgartira olmaydi. Ruxsat serverda ham tekshiriladi. Parol brauzer kodi yoki localStorage ichida saqlanmaydi. Bazada faqat scrypt bilan hisoblangan parol xeshi saqlanadi. Admin sessiyasi 8 soat amal qiladi; chiqish uni darhol bekor qiladi. Parol almashtirilganda boshqa qurilmalardagi sessiyalar yopiladi.

`ADMIN_PASSWORD` muhit o‘zgaruvchisi faqat **yangi baza birinchi marta yaratilganda** ishlaydi. Mavjud bazaning parolini o‘zgartirmaydi. Parolni yo‘qotmaslik uchun shaxsiy parol menejerida saqlang.

## Imkoniyatlar

- Har bir o‘quvchi va oy uchun “To‘langan / To‘lanmagan” tanlovi.
- O‘quv yillari bo‘yicha alohida ma’lumotlar va avtomatik saqlash.
- Dark/light rejim; tanlov brauzerda eslab qolinadi.
- Lotin va kirill yozuvida qidiruv; `/` tugmasi qidiruvni ochadi.
- Tanlangan oy bo‘yicha statistika va to‘lov holati filtri. Jadval ostidagi jami ko‘rinib turgan o‘quvchilar bo‘yicha hisoblanadi.
- Excelda ochiladigan UTF-8 CSV eksporti, tanlangan yilning barcha 25 o‘quvchisi bilan.
- O‘zgarishlar tarixi va boshqa oynalardagi o‘zgarishlarni 30 soniyada yangilash.
- Telefon uchun suriladigan jadval, qotirilgan ism ustuni va ustun sarlavhalari.

Ma’lumotlar `.data/fond.sqlite` SQLite bazasiga saqlanadi. Brauzerni yopish yoki serverni qayta ishga tushirish to‘lovlarni o‘chirmaydi. Ikki oynada bir katak bir vaqtda tahrirlansa, eskirgan o‘zgarish qaytariladi va jadval yangilanadi.

## Tekshirish

```sh
npm run check
npm test
```

Testlar alohida vaqtinchalik bazalarda ishlaydi, haqiqiy jadvalni o‘zgartirmaydi.

## Hosting

Bu Node.js serveri va doimiy disk talab qiladigan sayt. Faqat statik HTML hosting yetarli emas. HTTPS manzilini sozlab, quyidagi muhit o‘zgaruvchilarini hostingda kiriting:

```text
HOST=0.0.0.0
PORT=3000
APP_ORIGIN=https://sizning-saytingiz.uz
COOKIE_SECURE=true
DATA_DIR=/doimiy-disk/11-b-fond
```

`APP_ORIGIN` haqiqiy manzilga aynan teng bo‘lsin; oxiriga `/` qo‘ymang. TLS reverse proxy orqali sozlanadi. `.env.example` namuna sifatida berilgan; `.env` avtomatik yuklanmaydi. Node orqali yuklash uchun `node --env-file=.env server.mjs` ishlatishingiz mumkin.

Bazani zaxiralashning sodda usuli: serverni to‘xtatib, `.data` katalogidan nusxa oling va serverni yana ishga tushiring. Bu katalog hamda admin parolini ochiq repozitoriyga joylamang.
# 11-b
