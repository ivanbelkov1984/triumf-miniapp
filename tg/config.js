// Настройки мини-приложения ТРИУМФ для Telegram. Секретов здесь нет и быть не должно:
// токен бота хранится только в переменных сервиса на Railway (см. telegram-bot/README.md).
export const TG_CONFIG = {
  botUsername: 'TriumphMoto_bot',
  // Короткое имя мини-приложения из @BotFather (/newapp). Пока null: /newapp делается только в BotFather на телефоне
  // владельца бота. Тогда ссылки «Поделиться» и в заявке ведут на публичный адрес каталога с ?model=TR-xxx.
  appShortName: 'catalog',
  publicUrl: 'https://ivanbelkov1984.github.io/triumf-miniapp/tg/index.html',
  channelUrl: 'https://t.me/triumphmotosalon',
  // Приглашение в чат «ТРИУМФ Сервис — ремонт и обслуживание» (приватная группа). null — кнопка скрыта.
  serviceChatUrl: 'https://t.me/+MBQoxO0xOglmYTI6',
  // Если у Вадима появится имя пользователя в Telegram (t.me/имя), укажите его здесь без @:
  // тогда заявка откроется у него в чате уже набранной. Пока null — текст копируется, чат открывается по номеру.
  vadimUsername: null,
  // Слой 2 (по решению владельца): адрес веб-приложения Google Apps Script для мгновенных уведомлений Вадиму.
  // Пока null — заявка уходит через чат клиента с Вадимом, сервер не нужен.
  leadEndpoint: null,
  // Адрес сайта. null — сайт не опубликован: кнопка «Открыть сайт» и ссылки на его страницы скрыты.
  siteUrl: '../index.html',
  // Адрес сервиса админки (Railway, Европа). Здесь только публичный адрес; токен бота хранится в переменных Railway.
  apiBase: 'https://admin-api-production-b09f.up.railway.app',
};
