/*jshint esversion: 6*/
var express = require('express');
var app = express();
var crontab = require("./crontab");
var restore = require("./restore");
var package_json = require('./package.json');
var moment = require('moment');
var basicAuth = require('express-basic-auth');
var rateLimit = require('express-rate-limit');
var helmet = require('helmet');
var validator = require('validator');
var xss = require('xss');
var http = require('http');
var https = require('https');

var path = require('path');
var mime = require('mime-types');
var fs = require('fs');
var busboy = require('connect-busboy'); // for file upload

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdn.datatables.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdn.datatables.NET"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Stricter rate limiting for sensitive operations
const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 requests per windowMs
    message: 'Too many sensitive operations from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// base url
var base_url = require("./routes").base_url
app.locals.baseURL = base_url

// basic auth
var BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
var BASIC_AUTH_PWD = process.env.BASIC_AUTH_PWD;

// Enhanced authentication - require auth by default
if (!BASIC_AUTH_USER || !BASIC_AUTH_PWD) {
    console.warn('WARNING: No authentication configured. Set BASIC_AUTH_USER and BASIC_AUTH_PWD environment variables for security.');
    console.warn('Using default credentials - CHANGE THESE IMMEDIATELY!');
    BASIC_AUTH_USER = 'admin';
    BASIC_AUTH_PWD = 'changeme';
}

// Input validation function
function validateInput(input, type = 'general') {
    if (!input || typeof input !== 'string') return false;
    
    // Sanitize XSS
    input = xss(input);
    
    switch (type) {
        case 'command':
            // Block dangerous commands
            const dangerousCommands = [
                /\brm\s+(-rf\s+)?\//, // rm with root paths
                /\bmv\s+.*\s+\//, // mv to root
                /\bcp\s+.*\s+\//, // cp to root
                /\bchmod\s+(777|666)/, // dangerous permissions
                /\bchown\s+root/, // changing to root ownership
                /\bsu\s+/, // switch user
                /\bsudo\s+/, // sudo commands (unless explicitly allowed)
                /\b(wget|curl).*\|\s*(sh|bash)/, // download and execute
                /\b(nc|netcat).*-e/, // reverse shells
                /\beval\s*\(/, // eval execution
                /\bexec\s*\(/, // exec execution
                />\s*.*\/(etc|bin|sbin|usr\/bin|usr\/sbin)/, // redirect to system dirs
                /\;\s*(rm|mv|cp)\s+/, // chained dangerous commands
                /\|\s*(rm|mv|cp)\s+/, // piped dangerous commands
                /\&\&\s*(rm|mv|cp)\s+/, // conditional dangerous commands
            ];
            
            for (let pattern of dangerousCommands) {
                if (pattern.test(input)) {
                    return false;
                }
            }
            break;
        case 'schedule':
            // Validate cron expression format
            if (input.startsWith('@')) {
                const validMacros = ['@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'];
                return validMacros.includes(input);
            }
            // Basic cron pattern validation (5 or 6 fields)
            const cronParts = input.split(/\s+/);
            if (cronParts.length < 5 || cronParts.length > 6) return false;
            break;
        case 'name':
            // Validate job name
            if (input.length > 100) return false;
            if (!/^[a-zA-Z0-9_\-\s\.]+$/.test(input)) return false;
            break;
    }
    
    return input;
}

app.use(function(req, res, next) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Crontab UI - Restricted Access"')
    next();
});

app.use(basicAuth({
    users: {
        [BASIC_AUTH_USER]: BASIC_AUTH_PWD
    },
    challenge: true,
    realm: 'Crontab UI'
}));

// ssl credentials
var credentials = {
  key: process.env.SSL_KEY ? fs.readFileSync(process.env.SSL_KEY) : '',
  cert: process.env.SSL_CERT ? fs.readFileSync(process.env.SSL_CERT) : '',
}

if (
  (credentials.key && !credentials.cert) ||
  (credentials.cert && !credentials.key)
) {
    console.error('Please provide both SSL_KEY and SSL_CERT');
    process.exit(1);
  }

var startHttpsServer = credentials.key && credentials.cert;

// include the routes
var routes = require("./routes").routes;
var routes_relative = require("./routes").relative

// set the view engine to ejs
app.set('view engine', 'ejs');

var bodyParser = require('body-parser');
app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));
app.use(busboy()); // to support file uploads

// include all folders
app.use(base_url, express.static(__dirname + '/public'));
app.use(base_url, express.static(__dirname + '/public/css'));
app.use(base_url, express.static(__dirname + '/public/js'));
app.use(base_url, express.static(__dirname + '/config'));
app.set('views', __dirname + '/views');

// set host to 127.0.0.1 or the value set by environment var HOST
app.set('host', (process.env.HOST || '127.0.0.1'));

// set port to 8000 or the value set by environment var PORT
app.set('port', (process.env.PORT || 8000));

// root page handler
app.get(routes.root, function(req, res) {
  // reload the database before rendering
	crontab.reload_db();
	// send all the required parameters
	crontab.crontabs( function(docs){
		res.render('index', {
			routes : JSON.stringify(routes_relative),
			crontabs : JSON.stringify(docs),
			backups : crontab.get_backup_names(),
			env : crontab.get_env(),
      moment: moment
		});
	});
});

/*
Handle to save crontab to database
If it is a new job @param _id is set to -1
@param name, command, schedule, logging has to be sent with _id (if exists)
*/
app.post(routes.save, strictLimiter, function(req, res) {
	try {
		// Validate inputs
		const name = validateInput(req.body.name, 'name');
		const command = validateInput(req.body.command, 'command');
		const schedule = validateInput(req.body.schedule, 'schedule');
		
		if (!command) {
			return res.status(400).json({ error: 'Invalid or potentially dangerous command detected' });
		}
		
		if (!schedule) {
			return res.status(400).json({ error: 'Invalid schedule format' });
		}
		
		if (name && name.length > 100) {
			return res.status(400).json({ error: 'Job name too long' });
		}
		
		// Additional security check for extremely dangerous patterns
		if (/\b(format|mkfs|fdisk|dd.*of=\/dev|reboot|shutdown|halt|poweroff)\b/i.test(command)) {
			return res.status(403).json({ error: 'Command contains potentially destructive operations and is not allowed' });
		}
		
		// new job
		if(req.body._id == -1){
			crontab.create_new(name, command, schedule, req.body.logging, req.body.mailing);
		}
		// edit job
		else{
			crontab.update({
				_id: req.body._id,
				name: name,
				command: command,
				schedule: schedule,
				logging: req.body.logging,
				mailing: req.body.mailing
			});
		}
		res.json({ success: true });
	} catch (error) {
		console.error('Error saving crontab:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// set stop to job
app.post(routes.stop, strictLimiter, function(req, res) {
	try {
		if (!req.body._id) {
			return res.status(400).json({ error: 'Job ID is required' });
		}
		crontab.status(req.body._id, true);
		res.json({ success: true });
	} catch (error) {
		console.error('Error stopping job:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// set start to job
app.post(routes.start, strictLimiter, function(req, res) {
	try {
		if (!req.body._id) {
			return res.status(400).json({ error: 'Job ID is required' });
		}
		crontab.status(req.body._id, false);
		res.json({ success: true });
	} catch (error) {
		console.error('Error starting job:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// remove a job
app.post(routes.remove, strictLimiter, function(req, res) {
	try {
		if (!req.body._id) {
			return res.status(400).json({ error: 'Job ID is required' });
		}
		crontab.remove(req.body._id);
		res.json({ success: true });
	} catch (error) {
		console.error('Error removing job:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// run a job
app.post(routes.run, strictLimiter, function(req, res) {
	try {
		if (!req.body._id) {
			return res.status(400).json({ error: 'Job ID is required' });
		}
		crontab.runjob(req.body._id);
		res.json({ success: true });
	} catch (error) {
		console.error('Error running job:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// set crontab. Needs env_vars to be passed
app.get(routes.crontab, strictLimiter, function(req, res, next) {
	try {
		// Validate environment variables
		let env_vars = req.query.env_vars || '';
		if (env_vars) {
			env_vars = validateInput(env_vars);
			if (!env_vars) {
				return res.status(400).json({ error: 'Invalid environment variables' });
			}
		}
		
		crontab.set_crontab(env_vars, function(err) {
			if (err) {
				console.error('Error setting crontab:', err);
				return res.status(500).json({ error: 'Failed to set crontab' });
			}
			res.json({ success: true });
		});
	} catch (error) {
		console.error('Error in crontab route:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// backup crontab db
app.get(routes.backup, strictLimiter, function(req, res) {
	try {
		crontab.backup((err) => {
			if (err) {
				console.error('Error creating backup:', err);
				return res.status(500).json({ error: 'Failed to create backup' });
			}
			res.json({ success: true });
		});
	} catch (error) {
		console.error('Error in backup route:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// This renders the restore page similar to backup page
app.get(routes.restore, function(req, res) {
	try {
		// Validate db parameter
		const db = req.query.db;
		if (!db || !validator.isAlphanumeric(db.replace(/[\s\-\.]/g, ''))) {
			return res.status(400).json({ error: 'Invalid database name' });
		}
		
		// get all the crontabs
		restore.crontabs(db, function(docs){
			res.render('restore', {
				routes : JSON.stringify(routes_relative),
				crontabs : JSON.stringify(docs),
				backups : crontab.get_backup_names(),
				db: db
			});
		});
	} catch (error) {
		console.error('Error in restore route:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// delete backup db
app.get(routes.delete_backup, strictLimiter, function(req, res) {
	try {
		const db = req.query.db;
		if (!db || !validator.isAlphanumeric(db.replace(/[\s\-\.]/g, ''))) {
			return res.status(400).json({ error: 'Invalid database name' });
		}
		
		restore.delete(db);
		res.json({ success: true });
	} catch (error) {
		console.error('Error deleting backup:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// restore from backup db
app.get(routes.restore_backup, strictLimiter, function(req, res) {
	try {
		const db = req.query.db;
		if (!db || !validator.isAlphanumeric(db.replace(/[\s\-\.]/g, ''))) {
			return res.status(400).json({ error: 'Invalid database name' });
		}
		
		crontab.restore(db);
		res.json({ success: true });
	} catch (error) {
		console.error('Error restoring backup:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// export current crontab db so that user can download it
app.get(routes.export, function(req, res) {
	try {
		var file = crontab.crontab_db_file;

		// Security check - ensure file is within allowed directory
		if (!file.startsWith(crontab.db_folder)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		if (!fs.existsSync(file)) {
			return res.status(404).json({ error: 'File not found' });
		}

		var filename = path.basename(file);
		var mimetype = mime.lookup(file);

		res.setHeader('Content-disposition', 'attachment; filename=' + filename);
		res.setHeader('Content-type', mimetype);

		var filestream = fs.createReadStream(file);
		filestream.pipe(res);
	} catch (error) {
		console.error('Error exporting file:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// import from exported crontab db
app.post(routes.import, strictLimiter, function(req, res) {
	try {
		var fstream;
		req.pipe(req.busboy);
		req.busboy.on('file', function (fieldname, file, filename) {
			// Validate filename
			if (!filename || filename.length > 255) {
				return res.status(400).json({ error: 'Invalid filename' });
			}
			
			// Only allow .db files
			if (!filename.endsWith('.db')) {
				return res.status(400).json({ error: 'Only .db files are allowed' });
			}
			
			fstream = fs.createWriteStream(crontab.crontab_db_file);
			file.pipe(fstream);
			fstream.on('close', function () {
				crontab.reload_db();
				res.redirect(routes.root);
			});
		});
	} catch (error) {
		console.error('Error importing file:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// import from current ACTUALL crontab
app.get(routes.import_crontab, strictLimiter, function(req, res) {
	try {
		crontab.import_crontab();
		res.json({ success: true });
	} catch (error) {
		console.error('Error importing crontab:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

function sendLog(path, req, res) {
	try {
		// Security check - ensure path is within log folder
		if (!path.startsWith(crontab.log_folder)) {
			return res.status(403).json({ error: 'Access denied' });
		}
		
		if (fs.existsSync(path)) {
			// Additional security - limit file size to prevent DoS
			const stats = fs.statSync(path);
			if (stats.size > 10 * 1024 * 1024) { // 10MB limit
				return res.status(413).json({ error: 'Log file too large' });
			}
			res.sendFile(path);
		} else {
			res.status(404).send("No logs found for this job");
		}
	} catch (error) {
		console.error('Error sending log:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
}

// get the log file a given job. id passed as query param
app.get(routes.logger, function(req, res) {
	try {
		const id = req.query.id;
		if (!id || !validator.isAlphanumeric(id)) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}
		
		let _file = path.join(crontab.log_folder, id + ".log");
		sendLog(_file, req, res);
	} catch (error) {
		console.error('Error in logger route:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// get the log file a given job. id passed as query param
app.get(routes.stdout, function(req, res) {
	try {
		const id = req.query.id;
		if (!id || !validator.isAlphanumeric(id)) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}
		
		let _file = path.join(crontab.log_folder, id + ".stdout.log");
		sendLog(_file, req, res);
	} catch (error) {
		console.error('Error in stdout route:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// error handler
app.use(function(err, req, res, next) {
	var data = {};
	var statusCode = err.statusCode || 500;

	// Don't leak sensitive information in production
	if (process.env.NODE_ENV === 'production') {
		data.message = statusCode >= 500 ? 'Internal Server Error' : err.message;
	} else {
		data.message = err.message || 'Internal Server Error';
		if (err.stack) {
			data.stack = err.stack;
		}
	}

	if (statusCode >= 500) {
		console.error(err);
	}

	res.status(statusCode).json(data);
});

process.on('SIGINT', function() {
  console.log("Exiting crontab-ui");
  process.exit();
})

process.on('SIGTERM', function() {
  console.log("Exiting crontab-ui");
  process.exit();
})

var server = startHttpsServer ?
  https.createServer(credentials, app) : http.createServer(app);

server.listen(app.get('port'), app.get('host'), function() {
  console.log("Node version:", process.versions.node);
  fs.access(crontab.db_folder, fs.constants.W_OK, function(err) {
    if(err){
      console.error("Write access to", crontab.db_folder, "DENIED.");
      process.exit(1);
    }
  });
  // If --autosave is used then we will also save whatever is in the db automatically without having to mention it explictly
  // we do this by watching log file and setting a on change hook to it
  if (process.argv.includes("--autosave") || process.env.ENABLE_AUTOSAVE) {
    crontab.autosave_crontab(()=>{});
    fs.watchFile(crontab.crontab_db_file, () => {
      crontab.autosave_crontab(()=>{
        console.log("Attempted to autosave crontab");
      });
    });
  }
  if (process.argv.includes("--reset")){
    console.log("Resetting crontab-ui");
    var crontabdb = crontab.crontab_db_file;
    var envdb = crontab.env_file;

    console.log("Deleting " + crontabdb);
    try{
      fs.unlinkSync(crontabdb);
    } catch (e) {
      console.log("Unable to delete " + crontabdb);
    }

    console.log("Deleting " + envdb);
    try{
      fs.unlinkSync(envdb);
    } catch (e) {
      console.log("Unable to delete " + envdb);
    }

    crontab.reload_db();
  }

  var protocol = startHttpsServer ? "https" : "http";
  console.log("Crontab UI (" + package_json.version + ") is running at " + protocol + "://" + app.get('host') + ":" + app.get('port') + base_url);
});
