require('dotenv').config();
console.log('ACCOUNT_ID:', process.env.INSTAGRAM_ACCOUNT_ID);
console.log('TOKEN (len):', process.env.INSTAGRAM_ACCESS_TOKEN?.length);
