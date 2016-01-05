/*
 * (C) 2016 Seth Lakowske
 */

var Sequelize = require('sequelize');
var traverse  = require('traverse');
var objectly  = require('objectly');

/*
 * @param db name to use (e.g. myservicedb)
 * @param host to connect to (e.g. localhost)
 * @param engine to use (e.g. postgres, mysql, etc.)
 * @return a connection string.
 */
function connection(engine, host, db) {
    
    try {
        var config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
    } catch (error) {
        console.log(error);
        console.log("Couldn't loading configuration.");
    }

    var user = process.env['USER']
    if (config && config.user) user = config.user;

    var connection = engine+'://'+user+'@'+host+'/'+db;

    if (config && config.pass) {
        connection = engine+'://'+user+':'+config.pass+'@'+host+'/'+db;
    }

    return connection;
}

var conn = connection('postgres', 'db', 'zendo');
// Or you can simply use a connection uri
var sequelize = new Sequelize(conn);

var Doc = sequelize.define('doc', {
    sha1 : {
        type : Sequelize.STRING,
        primaryKey : true
    },
    value : Sequelize.JSON
});

var Link = sequelize.define('links', {});


function inflate(refs) {
    return function(x) {
        if (objectly.obj(this.node)) {
            var sha1 = this.node.sha1;
            if (sha1 !== undefined) {
                var obj = refs[sha1];
                if (obj !== undefined) {
                    this.update(refs[sha1]);
                } else {
                    console.log("couldn't find " + sha1 + " in object store");
                }
            }
        }
    }
}

function deflate(refs, refList, refPaths) {
    var refList  = refList || [];
    var refPaths = refPaths || [];
    return function(x) {
        if (this.circular) return;
        this.after(function(arg) {
            if (objectly.obj(this.node)) {
                var r = objectly.refify(this.node);
                var link = {path: this.path, link: r.sha1};
                refPaths.push(link);
                if (!(r.sha1 in refs)) {
                    refs[r.sha1] = this.node;
                    refList.push(this.node);
                }
                this.update(r);
            }
        })
    }
}

var e = {a : {b : {'beep':'boop'}, c : {'beep':'boop'}}, d : {'beep' : 'boop'}};
var refs = {};
var refList = [];
var refPaths = [];
var result = traverse(e).map(deflate(refs, refList, refPaths));

function clean(objects) {
    return objects.map(function(object) {
        return object.dataValues;
    })
}

var fatObj = {};

function create(object) {
    var r = {
        refs : {},
        refList : [],
        refPaths : []
    }
    
    r.root = traverse(object).map(deflate(r.refs, r.refList, r.refPaths));

    r.promise = Doc.bulkCreate(r.refList);

    return r;
}

function read(objectRef) {
    return Doc.findAll().then(function(docs) {
        var dataValues = clean(docs);
        fatObj = traverse(result).map(inflate(refs));
        return fatObj;
    });
}

// Force sync all models
sequelize.sync({force: true}).then(function() {
    var r = create(e);

    r.promise.then(function() {
        console.log('result: ', r);
        read(r.root).then(function(obj) {
            console.log('obj: ', obj);
        });

    });
})
