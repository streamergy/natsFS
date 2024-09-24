import nats from 'nats';
import fs, { ReadStream } from 'node:fs';
import process from 'node:process';
import crypto from 'crypto';
import { ArgumentParser } from 'argparse';

const parser = new ArgumentParser({
    // name: 'NATS Filesystem Sync',
    description: 'Sync objects from a NATS object store to your filesystem'
});
parser.add_argument('-u', '--host', { help: 'NATS broker host. Default "localhost:4222"'})
parser.add_argument('-t', '--token', { help: 'NATS broker token' })
parser.add_argument('-b', '--bucket', { help: 'NATS object bucket name' })
parser.add_argument('-m', '--mount', { help: 'Folder to sync objects to' })
parser.add_argument('-c', '--config', { help: 'Path to config file. CLI options override options from the file' })
parser.add_argument('-1', '--once', { help: 'Only run sync once, don\'t listen for NATS updates' })

let args = parser.parse_args();

if(args.config){
    const config = JSON.parse(fs.readFileSync(args.config));
    // undefined vars from args override
    for(const key in config){
        if(args[key] === undefined){
            args[key] = config[key];
        }
    }
}

if((!args.bucket) || (!args.mount)) {
    console.log('sync.js: error: the following arguments are required: -b/--bucket, -m/--mount');
    process.exit(1);
}

if(!args.host){
    args.host = 'localhost:4222';
}

const connection = await nats.connect({ servers: args.host, token: args.token });
const jetStream = connection.jetstream();
const objectBucket = await jetStream.views.os('fs');

const slashReplace = /^\/*/g;

async function pipeStream(readStream, writableStream) {
    const reader = readStream.getReader();

    return await new Promise((resolve, reject) => {
        let totalSize = 0;
        reader.read().then(function processText({ done, value }) {
            if(done){
                writableStream.end();
                resolve(totalSize);
                return;
            }

            writableStream.write(value);
            totalSize += value.length;
            reader.read().then(processText);
        });
    });
}

async function callFsFunction(fnct, ...args) {
    await new Promise((resolve, reject) => {
        fnct(...args, (err, data) => {
            if(err) reject(err);
            resolve(data);
        });
    });
}

async function downloadFile(path){
    path = path.replace(slashReplace, '');
    
    const parts = path.split('/');

    let currentPath = '';

    for(const part of parts.slice(0, -1)) {
        currentPath += `${part}/`;
        try{
            const stats = fs.statSync(currentPath);
            if(stats.isDirectory()) {
                continue;
            }
        } catch(e){
            if(e.code !== 'ENOENT'){
                throw e;
            } 
        }
        fs.mkdirSync(currentPath);
    }

    const natsHandle = await objectBucket.get(`/${path}`);
    return await pipeStream(natsHandle.data, fs.createWriteStream(path));
}

async function getHash(path, algorithm) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash(algorithm);
        const rs = fs.createReadStream(path);
        rs.on('error', reject);
        rs.on('data', chunk => hash.update(chunk));
        rs.on('end', () => {
            resolve(hash.digest('base64'))
        });
    })
}

async function syncFile(path, data){
    if(data === undefined){
        data = await objectBucket.info(path);
    }

    path = path.substring(1);

    if (data.deleted) {
        process.stdout.write(`${path}: deleting file...`);
        await callFsFunction(fs.unlink, path);
        console.log('done');
        return;
    }

    try{
        // const stats = await callFsFunction(fs.stat, path);

        let natsDigest = data.digest;
        const algorithm = natsDigest.split('=')[0];
        natsDigest = data
            .digest
            .substring(algorithm.length + 1)
            .replaceAll('_', '/')
            .replaceAll('-', '+');  

        const diskDigest = await getHash(path, algorithm);

        if (natsDigest === diskDigest) {
            // file is newest version
            console.log(`${path}: already newest version`);
            return;
        }
    }catch(e){
        if(e.code !== 'ENOENT'){
            throw e;
        }
    }

    process.stdout.write(`${path}: downloading file...`);
    const size = await downloadFile(path);
    console.log(`done (${size}B)`)
}

async function syncAllFiles() {
    const files = await objectBucket.list();
    for(const object of files){
        await syncFile(object.name, object);
    }
}

await syncAllFiles();

if(args.once){
    process.exit(0);
}

const watch = await objectBucket.watch();
for await(const update of watch){
    if(!update) {
        continue;
    }
    await syncFile(update.name, update);
}