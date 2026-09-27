import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {captchaRequest,challenge,captchaToken,puzzleOffset} from './support/captcha.mjs';
const base=process.env.API_BASE;
const isolated=/^mayday-check-\d+-[a-f0-9]{6}$/.test(process.env.API_TEST_COMPOSE_PROJECT??'')&&base&&process.env.ADMIN_PASSWORD;
test('登录滑动验证服务端边界',{skip:!isolated},async t=>{
  await t.test('不带验证凭证或伪造凭证不能调用密码登录',async()=>{
    await captchaRequest(base,'/auth/login',{username:'admin',password:process.env.ADMIN_PASSWORD},400);
    await captchaRequest(base,'/auth/login',{username:'admin',password:process.env.ADMIN_PASSWORD,captchaToken:'fake'},400);
  });
  await t.test('匿名挑战仅返回图片与尺寸，不返回目标位置或答案',async()=>{
    const puzzle=await challenge(base,'nonexistent-captcha-test');
    assert.deepEqual(Object.keys(puzzle).sort(),['challengeId','background','piece','width','height','pieceSize','y','expiresIn'].sort());
    assert(puzzle.background.startsWith('data:image/png;base64,'));
    assert.equal(puzzle.expiresIn,120);
  });
  await t.test('错误位置的一次尝试会作废原挑战',async()=>{
    const puzzle=await challenge(base,'admin');await delay(350);
    await captchaRequest(base,'/auth/captcha/verify',{challengeId:puzzle.challengeId,username:'admin',x:0,elapsedMs:350},400);
    await captchaRequest(base,'/auth/captcha/verify',{challengeId:puzzle.challengeId,username:'admin',x:puzzleOffset(puzzle),elapsedMs:350},400);
  });
  await t.test('通过凭证不能换账号使用，也不能重复使用',async()=>{
    const proof=await captchaToken(base,'admin');
    await captchaRequest(base,'/auth/login',{username:'another-account',password:'Unknown_2026!',captchaToken:proof},400);
    await captchaRequest(base,'/auth/login',{username:'admin',password:process.env.ADMIN_PASSWORD,captchaToken:proof},400);
  });
  await t.test('密码错误仍然消费凭证，不能复用验证进行连续密码尝试',async()=>{
    const proof=await captchaToken(base,'admin');
    await captchaRequest(base,'/auth/login',{username:'admin',password:'Wrong_Password_2026!',captchaToken:proof},401);
    await captchaRequest(base,'/auth/login',{username:'admin',password:process.env.ADMIN_PASSWORD,captchaToken:proof},400);
  });
  await t.test('正确拼图和密码可以登录，成功后凭证仍不可重放',async()=>{
    const proof=await captchaToken(base,'admin');
    const login=await captchaRequest(base,'/auth/login',{username:'admin',password:process.env.ADMIN_PASSWORD,captchaToken:proof});
    assert(login.token);
    await captchaRequest(base,'/auth/login',{username:'admin',password:process.env.ADMIN_PASSWORD,captchaToken:proof},400);
    const response=await fetch(base+'/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+login.token}});
    assert.equal(response.status,200);
  });
});
