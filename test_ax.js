const axios = require('axios');
async function run() {
  try {
    const res = await axios.post('http://127.0.0.1:1234/v1/chat/completions', {
      model: 'test', messages: [{role:'user', content:'hi'}], stream: true
    }, {responseType: 'stream'});
  } catch (error) {
    if (error.response?.data?.on) {
       let buf='';
       error.response.data.on('data', c=>buf+=c.toString());
       error.response.data.on('end', () => console.log('Parsed stream error:', JSON.parse(buf).error.message));
    } else {
       console.log('Plain error msg:', error.message);
    }
  }
}
run();
