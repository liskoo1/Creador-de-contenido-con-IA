const text = 'extrae los precios medios de ayer que tenemos en la pagina de www.helpmeagro.com de cada producto que hay en el home';
const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
console.log(text.match(urlRegex));
