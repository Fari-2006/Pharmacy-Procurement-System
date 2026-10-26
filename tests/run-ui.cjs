const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['tests/integration.cjs'],{stdio:'inherit',env:{...process.env,RUN_UI:'1'}});
child.on('exit',code=>process.exitCode=code||0);
