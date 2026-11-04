// Настройки мини-приложения ТРИУМФ для Telegram. Секретов здесь нет и быть не должно:
// токен бота хранится только в свойствах Google Apps Script (см. telegram-bot/README.md).
export const TG_CONFIG = {
  botUsername: 'TriumphMoto_bot',
  // Короткое имя мини-приложения из @BotFather (/newapp). Прямая ссылка: t.me/<бот>/<имя>?startapp=TR-011
  appShortName: 'catalog',
  channelUrl: 'https://t.me/triumphmotosalon',
  // Если у Вадима появится имя пользователя в Telegram (t.me/имя), укажите его здесь без @:
  // тогда заявка откроется у него в чате уже набранной. Пока null — текст копируется, чат открывается по номеру.
  vadimUsername: null,
  // Слой 2 (по решению владельца): адрес веб-приложения Google Apps Script для мгновенных уведомлений Вадиму.
  // Пока null — заявка уходит через чат клиента с Вадимом, сервер не нужен.
  leadEndpoint: null,
  // Адрес сайта. null — сайт не опубликован: кнопка «Открыть сайт» и ссылки на его страницы скрыты.
  siteUrl: null,
};
