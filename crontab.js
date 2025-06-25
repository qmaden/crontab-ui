/*jshint esversion: 6*/
//load database
var Datastore = require('@seald-io/nedb');
var path = require("path");
var validator = require('validator');

exports.db_folder = process.env.CRON_DB_PATH === undefined ? path.join(__dirname,  "crontabs") : process.env.CRON_DB_PATH;
console.log("Cron db path: " + exports.db_folder);
exports.log_folder = path.join(exports.db_folder, 'logs');
exports.env_file =  path.join(exports.db_folder, 'env.db');
exports.crontab_db_file = path.join(exports.db_folder, 'crontab.db');

var db = new Datastore({ filename: exports.crontab_db_file});
var cronPath = "/tmp";
if(process.env.CRON_PATH !== undefined) {
	console.log(`Path to crond files set using env variables ${process.env.CRON_PATH}`);
	cronPath = process.env.CRON_PATH;
}

db.loadDatabase(function (err) {
	if (err) throw err; // no hope, just terminate
});

var exec = require('child_process').exec;
var fs = require('fs');
var cron_parser = require("cron-parser");
var cronstrue = require('cronstrue/i18n');
var humanCronLocate = process.env.HUMANCRON ?? "en"

if (!fs.existsSync(exports.log_folder)){
    fs.mkdirSync(exports.log_folder);
}

// Security validation function
function validateCommandSecurity(command) {
	if (!command || typeof command !== 'string') return false;
	
	// Block dangerous patterns
	const dangerousPatterns = [
		/\brm\s+(-rf\s+)?\//, // rm with root paths
		/\bmv\s+.*\s+\//, // mv to root
		/\bcp\s+.*\s+\//, // cp to root
		/\bchmod\s+(777|666)/, // dangerous permissions
		/\bchown\s+root/, // changing to root ownership
		/\bsu\s+/, // switch user
		/\bsudo\s+/, // sudo commands
		/\b(wget|curl).*\|\s*(sh|bash)/, // download and execute
		/\b(nc|netcat).*-e/, // reverse shells
		/\beval\s*\(/, // eval execution
		/\bexec\s*\(/, // exec execution
		/>\s*.*\/(etc|bin|sbin|usr\/bin|usr\/sbin)/, // redirect to system dirs
		/\;\s*(rm|mv|cp)\s+/, // chained dangerous commands
		/\|\s*(rm|mv|cp)\s+/, // piped dangerous commands
		/\&\&\s*(rm|mv|cp)\s+/, // conditional dangerous commands
		/\b(format|mkfs|fdisk|dd.*of=\/dev|halt|poweroff)\b/i, // destructive commands
	];
	
	for (let pattern of dangerousPatterns) {
		if (pattern.test(command)) {
			console.warn(`Dangerous command pattern detected: ${command}`);
			return false;
		}
	}
	
	return true;
}

crontab = function(name, command, schedule, stopped, logging, mailing){
	// Validate inputs
	if (name && (typeof name !== 'string' || name.length > 100)) {
		throw new Error('Invalid job name');
	}
	
	if (!validateCommandSecurity(command)) {
		throw new Error('Command contains potentially dangerous operations');
	}
	
	if (!schedule || typeof schedule !== 'string') {
		throw new Error('Invalid schedule');
	}
	
	var data = {};
	data.name = name;
	data.command = command;
	data.schedule = schedule;
	if(stopped !== null) {
		data.stopped = stopped;
	}
	data.timestamp = (new Date()).toString();
	data.logging = logging;
	if (!mailing)
		mailing = {};
	data.mailing = mailing;
	return data;
};

exports.create_new = function(name, command, schedule, logging, mailing){
	try {
		var tab = crontab(name, command, schedule, false, logging, mailing);
		tab.created = new Date().valueOf();
		tab.saved = false;
		db.insert(tab);
	} catch (error) {
		console.error('Error creating new crontab:', error);
		throw error;
	}
};

exports.update = function(data){
	try {
		var tab = crontab(data.name, data.command, data.schedule, null, data.logging, data.mailing);
		tab.saved = false;
		db.update({_id: data._id}, tab);
	} catch (error) {
		console.error('Error updating crontab:', error);
		throw error;
	}
};

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
