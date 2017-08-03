#!/usr/bin/env node
const
  chalk     = require('chalk')
, only      = require('only')
, util      = require('util')
, inquirer  = require('inquirer')

, makeTx    = require('../lib/make-tx')
, Changelly = require('../lib/changelly')

, { collector, parseInput, formatSat, initArgs, checkFee, printErr } = require('./common')
, { inspect } = require('util')

const DUMMYOUT = { address: '1BitcoinEaterAddressDontSendf59kuE', value: 'ALL' }

const formatNum = (num, asStr) => asStr ? (+num).toFixed(8) : +(+num).toFixed(8)

const args = require('commander')
  .version(require('../package.json').version)
  .description(`${chalk.red('DUMP bcash')} 💩  ${chalk.green('HODL bitcoins')} 🚀:`)

  .option('-i, --input <input>', 'add input in txid:vout:amount:key format (amount in whole bitcoins, key in base58)', collector(parseInput), [])
  .option('-I, --inputs <file>', 'read inputs from CSV file')
  .option('-P, --payout <address>', 'send converted BTC to <address>')
  .option('-f, --feerate <rate>', 'set the feerate in satoshis/byte [default: rand(150,250)]', x => parseInt(x))

  .option('-E, --email <email>', 'email for changelly account (a new account will be created if no <pass> is specified)')
  .option('-W, --password <pass>', 'password for changelly account (optional)')
  .option('-C, --cookie <file>', 'read/write the changelly auth cookie to/from <file>')

  .option('-e, --electrum <server>', 'electrum server, must be bcash-compatible [default: random server]')
  .option('-p, --proxy <proxy>', 'proxy for connecting to electrum server and changelly')
  .option('-t, --tor', 'shortcut for --proxy socks5://127.0.0.1:9050')
  .option('-N, --noproxy', 'set if you\'re sure you don\'t want to use a proxy')

  .option('--crazyfee', 'disable the crazy fee sanity check (allow feerate>1000)')
  .option('--nogratuity', 'don\'t use an affiliate code to tip the authors of this software')
  .option('--whateverjustdump', 'skip all confirmations (for exchange rates, miner fees, etc) and just dump. this is probably a terrible idea.')

  .on('--help', _ => console.log('\n  Example:\n\n    $ bcash-instadump --input txid,vout,amount,key --payout 1BtcAddrGimmeRogersCoins --email zx@gmail.com'
                               + '\n\n  README:', chalk.underline('https://github.com/shesek/bcash-instadump'), '(really, do!)\n'))

  .parse(process.argv)

if (!(args.input.length && args.payout && args.email)) args.help()
initArgs(args)

// @XXX builds and discards a dummy transaction to estimate the tx amounts and fees. somewhat wasteful.
const bch_sent = formatSat(makeTx(args.input, [ DUMMYOUT ], args.feerate).outputs[0].value)

const client = Changelly(only(args, 'email password cookie proxy nogratuity'))

client.auth
  .then(u       => console.error(chalk.yellow('(info)'), 'logged-in to changelly as', chalk.yellowBright(u.email)))
  .then(_       => client.estimate(bch_sent))
  .then(btc_out => client.trade(bch_sent, btc_out, args.payout))
  .then(trade   => makeVerifyTx(trade))
  .then(tx      => console.log(tx.inspect(),'\n\n\n',tx.toRaw().toString('hex')))
  .catch(err    => Promise.reject(err == 'account-exists' ? accountExistsMsg : err))
  .catch(printErr)

const makeVerifyTx = trade => {
  const tx      = makeTx(args.input, [ { address: trade.payinAddress, value: 'ALL' } ], args.feerate)
      , btc_out = trade.amountExpectedTo

  if (!args.crazyfee) checkFee(tx)

  console.log('\nOrder', chalk.yellowBright(trade.transId), 'via Changelly account', chalk.yellowBright(client.auth._user.email)+':')
  console.log('  Sending', chalk.yellowBright(formatNum(bch_sent, true), 'BCH'), 'to', chalk.yellowBright(trade.payinAddress), '(changelly\'s bcash address)')
  console.log('  Getting', chalk.yellowBright(formatNum(btc_out, true), 'BTC'), 'to', chalk.yellowBright(trade.payoutAddress), '(your bitcoin address)')
  console.log('  Exchange fee:', chalk.yellowBright(trade.fee + '%'))
  console.log('\nTransaction', chalk.yellowBright(tx.txid())+':')
  console.log('  In:', chalk.yellowBright(formatSat(tx.getInputValue()), 'BCH'), 'from', chalk.yellowBright(tx.inputs.length), 'inputs')
  console.log('  Out:', chalk.yellowBright(formatSat(tx.getOutputValue()), 'BCH'), 'to', chalk.yellowBright(tx.outputs.length), 'outputs')
  console.log('  Miner fee:', chalk.yellowBright(formatSat(tx.getFee()), 'BCH')+',', 'rate:', chalk.yellowBright(tx.getRate(tx.view)/1000), 'satoshis/byte')
  if (tx.inputs.length > 1) console.log(' ', chalk.red('(warn)'), chalk.gray('merging multiple inputs together could harm your privacy. See README.md for more details.'))
  //console.log('\n  raw tx:', chalk.gray(tx.toRaw().toString('hex')))
  console.log('\nRates:')
  console.log(' ', chalk.red.bold('DUMP'), chalk.red(formatNum(bch_sent, true), 'BCH')+',', chalk.green.bold('GET'), chalk.green(formatNum(btc_out, true), 'BTC'))
  console.log(' ', '1 BTC', '=', chalk.yellowBright(formatNum(bch_sent/btc_out), 'BCH')+',', '1 BCH', '=', chalk.yellowBright(formatNum(btc_out/bch_sent), 'BTC'))
  console.log('\n ', chalk.red('(warn)'), 'Changelly does not commit to fixed rates, these are only their estimates.')
  console.log('         The actual rate is determined when the exchange is fulfilled, after several on-chain confirmations.')
  console.log('         See:', chalk.underline('https://changelly.com/faq#why-not-fix-rates'))

  console.log('\nPlease ensure that everything checks out. Confirming will dump your bcash - THERE\'S NO UNDO!')
  console.log('Canceling will print the raw transaction without broadcasting it.')

  return confirm('Dump?')
    .then(_ => tx)
    .catch(_ => {
      console.log('\n'+chalk.red('(canceled)'), 'not sending transaction:\n')
      console.log(util.inspect(tx.inspect(), { depth: 5, colors: true })+'\n')
      console.log(chalk.yellow('(rawtx)'), tx.toRaw().toString('hex')+'\n')
      console.log(chalk.yellow('(info)'), 'you may send this transaction manually with:\n       $ bcash-broadcast <rawtx>\n')
      return Promise.reject('user aborted')
    })
}

const confirm = message => args.whateverjustdump
  ? (console.log(chalk.green('?'), chalk.bold(message), chalk.gray('--whateverjustdump, skipping')), Promise.resolve(true))
  : inquirer.prompt([ { name: 'ok', type: 'confirm', message, default: false } ])
      .then(r => r.ok || Promise.reject('user aborted'))

const accountExistsMsg = 'an account already exists with this email address. if its yours, please authenticate with '+chalk.yellowBright('--password')+' or ' + chalk.yellowBright('--cookie') + '.'
