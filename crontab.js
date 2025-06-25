/*jshint esversion: 6*/
// Modern crontab management with performance enhancements
import Datastore from '@seald-io/nedb';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import validator from 'validator';
import cronParser from 'cron-parser';
import cronstrue from 'cronstrue/i18n';
import 'dotenv/config';

// Modern imports
import { config } from './config.js';
import { db as modernDb } from './database.js';
import { logger, logSecurityEvent } from './logger.js';
import { performanceMonitor } from './performance.js';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Promisify exec for better async handling
const execAsync = promisify(exec);

// Enhanced configuration
export const db_folder = process.env.CRON_DB_PATH === undefined ? join(__dirname, "crontabs") : process.env.CRON_DB_PATH;
logger.info("Cron db path: " + db_folder);
export const log_folder = join(db_folder, 'logs');
export const env_file = join(db_folder, 'env.db');
export const crontab_db_file = join(db_folder, 'crontab.db');

// Legacy NeDB support with modern fallback
const legacyDb = new Datastore({ filename: crontab_db_file});
const cronPath = process.env.CRON_PATH || "/tmp";
if(process.env.CRON_PATH !== undefined) {
	logger.info(`Path to crond files set using env variables ${process.env.CRON_PATH}`);
}

// Load legacy database with error handling
try {
	legacyDb.loadDatabase(function (err) {
		if (err) {
			logger.error('Failed to load legacy database:', err);
			throw err;
		}
		logger.info('Legacy NeDB database loaded successfully');
	});
} catch (error) {
	logger.error('Critical error loading legacy database:', error);
	throw error;
}

const humanCronLocate = process.env.HUMANCRON ?? "en"
logger.info("Cron db path: " + db_folder);
export const log_folder = join(db_folder, 'logs');
export const env_file = join(db_folder, 'env.db');
export const crontab_db_file = join(db_folder, 'crontab.db');

// Legacy NeDB support with modern fallback
const legacyDb = new Datastore({ filename: crontab_db_file});
const cronPath = process.env.CRON_PATH || "/tmp";
if(process.env.CRON_PATH !== undefined) {
	logger.info(`Path to crond files set using env variables ${process.env.CRON_PATH}`);
}

// Load legacy database with error handling
try {
	legacyDb.loadDatabase(function (err) {
		if (err) {
			logger.error('Failed to load legacy database:', err);
			throw err;
		}
		logger.info('Legacy NeDB database loaded successfully');
	});
} catch (error) {
	logger.error('Critical error loading legacy database:', error);
	throw error;
}

const humanCronLocate = process.env.HUMANCRON ?? "en"

// Create log folder if it doesn't exist
if (!fs.existsSync(log_folder)){
    fs.mkdirSync(log_folder, { recursive: true });
}

// Enhanced security validation with performance monitoring
function validateCommandSecurity(command) {
	const timer = performanceMonitor.startTimer('validate_command_security');
	
	try {
		if (!command || typeof command !== 'string') {
			logSecurityEvent('Command validation failed: Invalid input type', { command });
			return false;
		}
		
		// Enhanced security patterns with modern regex
		const dangerousPatterns = [
			/\brm\s+(-rf\s+)?\//, // rm with root paths
			/\bmv\s+.*\s+\//, // mv to root
			/\bcp\s+.*\s+\//, // cp to root
			/\bchmod\s+(777|666)/, // dangerous permissions
			/\bchown\s+root/, // changing to root ownership
			/\bsu\s+/, // switch user
			/\bsudo\s+/, // sudo commands
			/\b(wget|curl).*\|\s*(sh|bash|zsh|fish)/, // download and execute
			/\b(nc|netcat|ncat).*(-e|-c)/, // reverse shells
			/\beval\s*\(/, // eval execution
			/\bexec\s*\(/, // exec execution
			/>\s*.*\/(etc|bin|sbin|usr\/bin|usr\/sbin)/, // redirect to system dirs
			/\;\s*(rm|mv|cp|chmod|chown)\s+/, // chained dangerous commands
			/\|\s*(rm|mv|cp|chmod|chown)\s+/, // piped dangerous commands
			/\&\&\s*(rm|mv|cp|chmod|chown)\s+/, // conditional dangerous commands
			/\b(format|mkfs|fdisk|dd.*of=\/dev|halt|poweroff|reboot|shutdown)\b/i, // destructive commands
			/\b(python|python3|node|php|ruby|perl)\s+.*-c\s+/, // script execution
			/\b(bash|sh|zsh|fish)\s+.*-c\s+/, // shell execution
			/\$(.*)\s*\|\s*(sh|bash|zsh)/, // variable expansion to shell
			/\bkill\s+(-9\s+)?1\b/, // kill init process
			/\b(docker|kubectl|systemctl)\s+(run|exec|start|stop|restart)/, // container/service management
		];
		
		// Check each pattern
		for (let pattern of dangerousPatterns) {
			if (pattern.test(command)) {
				logSecurityEvent('Dangerous command pattern detected', { 
					command, 
					pattern: pattern.source,
					severity: 'high'
				});
				return false;
			}
		}
		
		// Additional XSS protection for command content
		if (command.includes('<script>') || command.includes('javascript:')) {
			logSecurityEvent('XSS attempt in command', { command });
			return false;
		}
		
		// Check command length to prevent buffer overflow attempts
		if (command.length > 2000) {
			logSecurityEvent('Command exceeds maximum length', { 
				command: command.substring(0, 100) + '...', 
				length: command.length 
			});
			return false;
		}
		
		return true;
	} finally {
		timer.end();
	}
}

// Enhanced crontab validation with modern practices
function validateCronSchedule(schedule) {
	const timer = performanceMonitor.startTimer('validate_cron_schedule');
	
	try {
		if (!schedule || typeof schedule !== 'string') return false;
		
		// Clean up schedule
		schedule = schedule.trim();
		
		// Validate using cron-parser
		try {
			cronParser.parseExpression(schedule);
			return true;
		} catch (error) {
			logger.warn('Invalid cron schedule:', { schedule, error: error.message });
			return false;
		}
	} finally {
		timer.end();
	}
}

// Modern crontab creation with enhanced validation
function createCrontab(name, command, schedule, stopped, logging, mailing) {
	const timer = performanceMonitor.startTimer('create_crontab');
	
	try {
		// Enhanced input validation
		if (name && (typeof name !== 'string' || name.length > 100 || name.length < 1)) {
			throw new Error('Invalid job name: must be 1-100 characters');
		}
		
		// Sanitize name to prevent injection
		if (name && !validator.isAlphanumeric(name.replace(/[-_\s]/g, ''))) {
			throw new Error('Job name contains invalid characters');
		}
		
		if (!validateCommandSecurity(command)) {
			throw new Error('Command contains potentially dangerous operations');
		}
		
		if (!validateCronSchedule(schedule)) {
			throw new Error('Invalid cron schedule format');
		}
		
		// Create sanitized data object
		const data = {
			name: validator.escape(name || ''),
			command: command.trim(),
			schedule: schedule.trim(),
			stopped: Boolean(stopped),
			timestamp: new Date().toISOString(),
			logging: Boolean(logging),
			mailing: mailing || {},
			created: Date.now(),
			lastModified: Date.now(),
			version: '2.0', // Version for tracking data format
			saved: false
		};
		
		logger.info('Created new crontab entry', { name: data.name, schedule: data.schedule });
		return data;
	} finally {
		timer.end();
	}
}

// Modernized create_new function with dual database support
export async function create_new(name, command, schedule, logging, mailing) {
	const timer = performanceMonitor.startTimer('create_new_crontab');
	
	try {
		const tab = createCrontab(name, command, schedule, false, logging, mailing);
		
		// Store in modern database if available
		if (config.database.type === 'sqlite' && modernDb) {
			try {
				await modernDb.query(
					'INSERT INTO crontabs (name, command, schedule, stopped, logging, mailing, created, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
					[tab.name, tab.command, tab.schedule, tab.stopped, tab.logging, JSON.stringify(tab.mailing), tab.created, tab.timestamp]
				);
				logger.info('Crontab stored in modern SQLite database');
			} catch (error) {
				logger.error('Failed to store in modern database, falling back to legacy:', error);
			}
		}
		
		// Store in legacy database as fallback
		return new Promise((resolve, reject) => {
			legacyDb.insert(tab, function(err, doc) {
				if (err) {
					logger.error('Failed to create crontab in legacy database:', err);
					reject(err);
				} else {
					logger.info('Crontab created successfully', { id: doc._id, name: doc.name });
					resolve(doc);
				}
			});
		});
	} catch (error) {
		logger.error('Error creating new crontab:', error);
		throw error;
	} finally {
		timer.end();
	}
}

// Modernized update function with dual database support
export async function update(data) {
	const timer = performanceMonitor.startTimer('update_crontab');
	
	try {
		const tab = createCrontab(data.name, data.command, data.schedule, null, data.logging, data.mailing);
		tab.lastModified = Date.now();
		tab.saved = false;
		
		// Update in modern database if available
		if (config.database.type === 'sqlite' && modernDb && data._id) {
			try {
				await modernDb.query(
					'UPDATE crontabs SET name = ?, command = ?, schedule = ?, logging = ?, mailing = ?, lastModified = ? WHERE id = ?',
					[tab.name, tab.command, tab.schedule, tab.logging, JSON.stringify(tab.mailing), tab.lastModified, data._id]
				);
				logger.info('Crontab updated in modern database');
			} catch (error) {
				logger.error('Failed to update in modern database:', error);
			}
		}
		
		// Update in legacy database
		return new Promise((resolve, reject) => {
			legacyDb.update({_id: data._id}, tab, {}, function(err, numReplaced) {
				if (err) {
					logger.error('Error updating crontab in legacy database:', err);
					reject(err);
				} else {
					logger.info('Crontab updated successfully', { id: data._id, replaced: numReplaced });
					resolve(numReplaced);
				}
			});
		});
	} catch (error) {
		logger.error('Error updating crontab:', error);
		throw error;
	} finally {
		timer.end();
	}
}

exports.status = function(_id, stopped){
	if (!_id) {
		throw new Error('Job ID is required');
	}
	db.update({_id: _id},{$set: {stopped: stopped, saved: false}});
};

exports.remove = function(_id){
	if (!_id) {
		throw new Error('Job ID is required');
	}
	db.remove({_id: _id}, {});
};

// Iterates through all the crontab entries in the db and calls the callback with the entries
exports.crontabs = function(callback){
	db.find({}).sort({ created: -1 }).exec(function(err, docs){
		if (err) {
			console.error('Error fetching crontabs:', err);
			return callback([]);
		}
		
		for(var i=0; i<docs.length; i++){
			try {
				if(docs[i].schedule == "@reboot") {
					docs[i].human = "At system startup";
					docs[i].next = "Next Reboot";
				}
				else if(docs[i].schedule.startsWith("@")) {
					// Handle other cron macros
					const macros = {
						"@yearly": "Once a year (0 0 1 1 *)",
						"@annually": "Once a year (0 0 1 1 *)",
						"@monthly": "Once a month (0 0 1 * *)",
						"@weekly": "Once a week (0 0 * * 0)",
						"@daily": "Once a day (0 0 * * *)",
						"@midnight": "Once a day (0 0 * * *)",
						"@hourly": "Once an hour (0 * * * *)"
					};
					
					docs[i].human = macros[docs[i].schedule] || docs[i].schedule;
					if (docs[i].schedule !== "@reboot") {
						try {
							docs[i].next = cron_parser.parseExpression(docs[i].schedule).next().toString();
						} catch(err) {
							docs[i].next = "invalid";
						}
					}
				}
				else {
					docs[i].human = cronstrue.toString(docs[i].schedule, { locale: humanCronLocate });
					docs[i].next = cron_parser.parseExpression(docs[i].schedule).next().toString();
				}
			} catch(err) {
				console.error('Error parsing schedule for job:', docs[i]._id, err);
				docs[i].human = "Invalid schedule";
				docs[i].next = "invalid";
			}
		}
		callback(docs);
	});
};

exports.get_crontab = function(_id, callback) {
	db.find({_id: _id}).exec(function(err, docs){
		callback(docs[0]);
	});
};

exports.runjob = function(_id) {
	db.find({_id: _id}).exec(function(err, docs){
		let res = docs[0];

		let env_vars = exports.get_env()

		let crontab_job_string_command = make_command(res)

		crontab_job_string_command = add_env_vars(env_vars, crontab_job_string_command)

		console.log("Running job")
		console.log("ID: " + _id)		
		console.log("Original command: " + res.command)
		console.log("Executed command: " + crontab_job_string_command)

		exec(crontab_job_string_command, function(error, stdout, stderr){
			if (error) {
				console.log(error)
			}
		});
	});
};

make_command = function(tab) {
	var crontab_job_string = "";

	let stderr = path.join(cronPath, tab._id + ".stderr");
	let stdout = path.join(cronPath, tab._id + ".stdout");
	let log_file = path.join(exports.log_folder, tab._id + ".log");
	let log_file_stdout = path.join(exports.log_folder, tab._id + ".stdout.log");

	var crontab_job_string_command = tab.command

	if(crontab_job_string_command[crontab_job_string_command.length-1] != ";") { // add semicolon
		crontab_job_string_command +=";";
	}

	crontab_job_string = crontab_job_string_command
	crontab_job_string =  "{ " + crontab_job_string + " }" 
	// write stdout to file
	crontab_job_string =  "(" + crontab_job_string + " | tee " + stdout + ")"
	// write stderr to file
	crontab_job_string = "(" + crontab_job_string + " 3>&1 1>&2 2>&3 | tee " + stderr + ") 3>&1 1>&2 2>&3"
	crontab_job_string =  "(" + crontab_job_string + ")"

	if (tab.logging && tab.logging == "true") {
		crontab_job_string += "; if test -f " + stderr +
		"; then date >> \"" + log_file + "\"" +
		"; cat " + stderr + " >> \"" + log_file + "\"" +
		"; fi";

		crontab_job_string += "; if test -f " + stdout +
		"; then date >> \"" + log_file_stdout + "\"" +
		"; cat " + stdout + " >> \"" + log_file_stdout + "\"" +
		"; fi";
	}

	if (tab.hook) {
		crontab_job_string += "; if test -f " + stdout +
		"; then " + tab.hook + " < " + stdout +
		"; fi";
	}

	if (tab.mailing && JSON.stringify(tab.mailing) != "{}"){
		crontab_job_string += "; /usr/local/bin/node " + __dirname + "/bin/crontab-ui-mailer.js " + tab._id + " " + stdout + " " + stderr;
	}

	return crontab_job_string;
}

add_env_vars = function(env_vars, command) {
	console.log("env vars");
	console.log(env_vars)
	if (env_vars)
		return "(" + env_vars.replace(/\s*\n\s*/g,' ').trim() + "; (" + command + "))";
	
	return command;
}

// Set actual crontab file from the db
exports.set_crontab = function(env_vars, callback) {
	exports.crontabs( function(tabs){
		var crontab_string = "";
		if (env_vars) {
			crontab_string += env_vars;
			crontab_string += "\n";
		}
		tabs.forEach(function(tab){
			if(!tab.stopped) {
				crontab_string += tab.schedule
				crontab_string += " "
				crontab_string += make_command(tab)
				crontab_string += "\n";
			}
		});

		fs.writeFile(exports.env_file, env_vars, function(err) {
			if (err) {
				console.error(err);
				callback(err);
			}
			// In docker we're running as the root user, so we need to write the file as root and not crontab
			var fileName = process.env.CRON_IN_DOCKER !== undefined  ? "root" : "crontab";
			fs.writeFile(path.join(cronPath, fileName), crontab_string, function(err) {
				if (err) {
					console.error(err);
					return callback(err);
				}

				exec("crontab " + path.join(cronPath, fileName), function(err) {
					if (err) {
						console.error(err);
						return callback(err);
					}
					else {
						db.update({},{$set: {saved: true}}, {multi: true});
						callback();
					}
				});
			});
		});
	});
};

exports.get_backup_names = function(){
	var backups = [];
	fs.readdirSync(exports.db_folder).forEach(function(file){
		// file name begins with backup
		if(file.indexOf("backup") === 0){
			backups.push(file);
		}
	});

	let backup_date = (backup_name) => {
		let T = backup_name.split("backup")[1];
		return new Date(T.substring(0, T.length-3)).valueOf();
	}

	backups.sort((a, b) => backup_date(b) - backup_date(a));

	return backups;
};

exports.backup = (callback) => {
	fs.copyFile(exports.crontab_db_file, path.join(exports.db_folder, 'backup ' + (new Date()).toString().replace("+", " ") + '.db'), (err) => {
		if (err) {
			console.error(err);
			return callback(err);
		}
		callback();
	});
};

exports.restore = function(db_name){
	fs.createReadStream(path.join(exports.db_folder, db_name)).pipe(fs.createWriteStream(exports.crontab_db_file));
	db.loadDatabase(); // reload the database
};

exports.reload_db = function(){
	db.loadDatabase();
};

exports.get_env = function(){
	if (fs.existsSync(exports.env_file)) {
		return fs.readFileSync(exports.env_file , 'utf8').replace("\n", "\n");
	}
	return "";
};

exports.import_crontab = function(){
	exec("crontab -l", function(error, stdout, stderr){
		var lines = stdout.split("\n");
		var namePrefix = new Date().getTime();

		lines.forEach(function(line, index){
			line = line.replace(/\t+/g, ' ');
			var regex = /^((\@[a-zA-Z]+\s+)|(([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+))/;
			var command = line.replace(regex, '').trim();
			var schedule = line.replace(command, '').trim();

			var is_valid = false;
			try { is_valid = cron_parser.parseString(line).expressions.length > 0; } catch (e){}

			if(command && schedule && is_valid){
				var name = namePrefix + '_' + index;

				db.findOne({ command: command, schedule: schedule }, function(err, doc) {
					if(err) {
						throw err;
					}
					if(!doc){
						exports.create_new(name, command, schedule, null);
					}
					else{
						doc.command = command;
						doc.schedule = schedule;
						exports.update(doc);
					}
				});
			}
		});
	});
};

exports.autosave_crontab = function(callback) {
	let env_vars = exports.get_env();
	exports.set_crontab(env_vars, callback);
};
