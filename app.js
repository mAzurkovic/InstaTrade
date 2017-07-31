var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('express-session');
var passport = require('passport');
var SteamStrategy = require('passport-steam').Strategy;
const mongoose = require('mongoose');
const passportSocket = require('passport.socketio');
const async = require('async');
const http = require('http');
const socket = require('socket.io');
const MongoStore = require('connect-mongo')(session);
const SteamCommunity = require('steamcommunity');

const Inventory = require('./models/inventory');
const Item = require('./models/item');
const User = require('./models/user');
const Price = require('./models/price');

const priceUpdater = require('./helpers/priceUpdater');

var index = require('./routes/index');
var users = require('./routes/users');

const server = http.Server(app);
const io = socket(server);
const community = new SteamCommunity();
const sessionStore = new MongoStore({ mongooseConnection: mongoose.connection });

var app = express();


mongoose.connect('mongodb://127.0.0.1:27017/InstaTrade');
priceUpdater(6 * 60 * 60 * 1000);

passport.serializeUser((user, done) => {
	User.update({
		steamid: user.id
	}, {
		$set: user._json
	}, { upsert: true }, (err) => {
		done(err, user._json);
	});
});

passport.deserializeUser((obj, done) => {
	User.findOne({
		steamid: obj.steamid
	}, (err, user) => {
		done(err, user);
	});
});


passport.use(new SteamStrategy({
		returnURL: 'http://localhost:3000/auth/steam/return',
		realm: 'http://localhost:3000/',
		apiKey: '938FE642035877C276704FB8525DEA61'
	}, (identifier, profile, done) => {
		return done(null, profile);
	}
));

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

//app.use('/', index);
//app.use('/users', users);


io.use(passportSocket.authorize({
	cookieParser: cookieParser,
	key: 'INSTATRADE_SESSION',
	secret: 'malakrsna10',
	store: sessionStore
}));

io.on('connection', (socket) => {
	socket.on('deposit', (data) => {
		const user = socket.request.user;
		console.log(`${user.personaname} is depositting ${data.assetid}`);
		// we'll send the trade offer here
	});

	socket.on('withdraw', (data) => {
		const user = socket.request.user;
		console.log(`${user.personaname} is withdrawing ${data.assetid}`);
		// we'll send the trade offer here
	});
});

app.use(session({
    secret: 'malakrsna10',
    name: 'INSTATRADE_SESSION',
    resave: true,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static('public'));
app.use(cookieParser());

app.get('/', (req, res) => {

	if (req.user) {
		Inventory.findOne({
			steamid: req.user.steamid
		}, (err, inv) => {
			if (inv && (Date.now() - inv.updated) > 30 * 60 * 1000) {
				res.render('deposit', {
					user: req.user,
					items: inv.items
				});
			} else {
				community.getUserInventoryContents(req.user.steamid, 730, 2, true, (err, inv) => {
					if (err) {
						console.log(err);
					} else {
						async.map(inv, (item, done) => {
							Price.findOne({
								market_hash_name: item.market_hash_name
							}, (err, doc) => {
								item.price = doc ? doc.price : '?';
								done(null, item);
							});
						}, (err, results) => {
							Inventory.update({
								steamid: req.user.steamid
							}, {
								$set: {
									updated: Date.now(),
									items: results
								}
							}, (err) => {
								if (err) {
									console.log(err);
								}
							});

							res.render('main', {
								user: req.user,
								items: results
							});
						});
					}
				});
			}
		});
	} else {
		//res.redirect('/auth/steam');
		res.render('main', {user: 0})
	}

});





app.get('/deposit', (req, res) => {
	if (req.user) {
		Inventory.findOne({
			steamid: req.user.steamid
		}, (err, inv) => {
			if (inv && (Date.now() - inv.updated) > 30 * 60 * 1000) {
				res.render('deposit', {
					user: req.user,
					items: inv.items
				});
			} else {
				community.getUserInventoryContents(req.user.steamid, 730, 2, true, (err, inv) => {
					if (err) {
						console.log(err);
					} else {
						async.map(inv, (item, done) => {
							Price.findOne({
								market_hash_name: item.market_hash_name
							}, (err, doc) => {
								item.price = doc ? doc.price : '?';
								done(null, item);
							});
						}, (err, results) => {
							Inventory.update({
								steamid: req.user.steamid
							}, {
								$set: {
									updated: Date.now(),
									items: results
								}
							}, (err) => {
								if (err) {
									console.log(err);
								}
							});

							res.render('deposit', {
								user: req.user,
								items: results
							});
						});
					}
				});
			}
		});
	} else {
		res.redirect('/auth/steam');
	}
});

app.get('/withdraw', (req, res) => {
	if (req.user) {
		Item.find({}, (err, inv) => {
			async.map(inv, (item, done) => {
				Price.findOne({
					market_hash_name: item.name
				}, (err, doc) => {
					item.price = doc ? doc.price : '?';
					done(null, item.toObject());
				});
			}, (err, results) => {
				res.render('withdraw', {
					user: req.user,
					items: results
				});
			});
		});
	} else {
		res.redirect('/auth/steam');
	}
});





app.get(/^\/auth\/steam(\/return)?$/,
	passport.authenticate('steam', { failureRedirect: '/' }),
	(req, res) => {
		res.redirect('/');
	});

app.get('/logout', (req, res) => {
	req.logout();
	res.redirect('/');
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
