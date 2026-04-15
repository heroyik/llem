const axios = require('axios');
async function run() {
  try {
     await axios.post('http://127.0.0.1:1234/v1/chat/completions', {model:'test',messages:[{role:'user',content:'a'}]}, {responseType:'stream'});
  } catch(error) {
     const status = error.response?.status;
     console.log('STATUS:', status);
     if (error.response?.data?.on) {
       let b='';
       error.response.data.on('data',c=>b+=c.toString());
       error.response.data.on('end',()=>console.log('BODY:', b));
     }
  }
}
run();
