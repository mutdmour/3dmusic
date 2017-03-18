(function () {
    var script = document.currentScript,
        codecs = {
            mp3: 'audio/mpeg',
            ogg: 'audio/ogg',
            webm: 'audio/webm'
        },
        resize = (function () {
            var resized = false,
                callbacks = [],
                timeout;

            function tick() {
                if(resized) {
                    callbacks.forEach(function (callback) {
                        callback();
                    });
                }

                resized = false;
                timeout = setTimeout(tick, 10);
            }

            window.addEventListener('resize', function () {
                resized = true;
            });

            function resize(callback) {
                callbacks.push(callback);
                callback();
            }

            tick();

            return resize;
        })(),
        settings;


    function remove(node) {
        if(node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }

    function inReverse(a, b) {
        return b.localeCompare(a);
    }

    function AudioAnalyser() {
        this.audio = new Audio();
        this.canplay = false;
        this.seeking = false;
        this.context = new AudioAnalyser.AudioContext();
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = settings.size * 2; /* The amount of data values is generally half the fftSize */
        this.analyser.smoothingTimeConstant = settings.smoothing;
        this.analyser.minDecibels = settings.mindecibels;
        this.analyser.maxDecibels = settings.maxdecibels;
        this.source = null;
        this.gainNode = null;
        this.events = {};
        this.song =  -1; /* calling next() will load first song */
    }

    AudioAnalyser.prototype.next = function () {
        this.song = (this.song + 1) % settings.audio.length;
        this.load(settings.audio[this.song]);
    };

    AudioAnalyser.prototype.last = function () {
        this.song = (this.song + settings.audio.length - 1) % settings.audio.length;
        this.load(settings.audio[this.song]);
    };

    AudioAnalyser.prototype.initialize = function () {
        var self = this;

        ['canplay', 'ended', 'pause', 'playing', 'progress', 'timeupdate'].forEach(function (name) {
            self.audio.addEventListener(name, function (event) {
                self.emit(name, event);
            });
        });

        self.audio.addEventListener('canplay', function () {
            var canplay = self.canplay;

            self.canplay = true;

            if(settings.autoplay) {
               self.play();
            }

            if(AudioAnalyser.enabled && !canplay) {
                self.source = self.context.createMediaElementSource(self.audio);
                self.source.connect(self.analyser);
                self.gainNode = self.context.createGain();
                self.gainNode.gain.value = settings.volume;
                self.analyser.connect(self.gainNode);
                self.gainNode.connect(self.context.destination);
            }
        });

        self.addEventListener('seeking', function (event) {
            self.pause();
            self.seeking = true;
            self.audio.currentTime = event.currentTime;
        });

        self.addEventListener('seeked', function (event) {
            self.seeking = false;
            if(event.resume) {
                self.play();
            }
        });

        self.audio.addEventListener('ended', self.next.bind(self));

        self.next();
    };

    AudioAnalyser.prototype.load = function (song) {
        var audio = this.audio,
            props = Object.getOwnPropertyNames(song),
            i,
            prop,
            source;

        audio.pause();
        Array.prototype.slice.call(audio.children).forEach(remove);
        props.sort(inReverse);

        for(i = 0; i < props.length; i++) {
            prop = props[i];

            if(prop === 'title') {
                this.emit('title', {title: song[prop]});
            } else {
                source = document.createElement('source');
                source.type = codecs[prop];
                source.src = song[prop];
                audio.appendChild(source);
            }
        }

        audio.controls = true;

        if(settings.autoplay) {
            audio.autoplay = true;
        }

        audio.load();
    };

    AudioAnalyser.prototype.play = function () {
        if(this.audio.paused && this.canplay && !this.seeking) {
            this.audio.play();
            // console.log(this.audio.duration);
        }
    };

    AudioAnalyser.prototype.getDuration = function () {
        if (this.canplay){
            return this.audio.duration;
        }
    }

    AudioAnalyser.prototype.pause = function () {
        if(!this.audio.paused) {
            this.audio.pause();
        }
    };

    AudioAnalyser.prototype.addEventListener = function (event, callback) {
        if(typeof callback !== 'function' || (this.events[event] && !this.events.hasOwnProperty(event))) {
            return;
        }

        if(!this.events.hasOwnProperty(event)) {
            this.events[event] = [callback];
        } else if(Array.isArray(this.events[event])) {
            this.events[event].push(callback);
        }
    };

    AudioAnalyser.prototype.emit = function (event, data) {
        if(this.events.hasOwnProperty(event) && Array.isArray(this.events[event])) {
            for(var i = 0; i < this.events[event].length; i++) {
                this.events[event][i].call(this, data);
            }
        }
    };

    AudioAnalyser.AudioContext = window.AudioContext || window.webkitAudioContext;

    AudioAnalyser.enabled = (AudioAnalyser.AudioContext !== undefined);

    function makeControls(audioanalyser, container) {
        var link = document.createElement('link'),
            controls = document.createElement('div'),
            back = document.createElement('div'),
            toggle = document.createElement('div'),
            skip = document.createElement('div'),
            seekbar = document.createElement('div'),
            seekinner = document.createElement('div'),
            buffered = document.createElement('div'),
            played = document.createElement('div'),
            seekbtn = document.createElement('div'),
            time = document.createElement('div'),
            speaker = document.createElement('div'),
            volbar = document.createElement('div'),
            volinner = document.createElement('div'),
            volume = document.createElement('div'),
            volbtn = document.createElement('div'),
            dragbar,
            innerbar,
            dragbtn,
            dragging = false,
            muted = false,
            lastVol = settings.volume,
            resume;

        function setTime(currentTime) {
            var seconds = Math.floor(currentTime),
                minutes = Math.floor(seconds / 60),
                timeStr = '';

            timeStr += minutes + ':';
            seconds -= minutes * 60;
            timeStr += ('0' + seconds).slice(-2);

            time.textContent = timeStr;
        }

        function getPos(event, element) {
            var x = event.clientX,
                y = event.clientY,
                currentElement = element;
            
            do {
                x -= currentElement.offsetLeft - currentElement.scrollLeft;
                y -= currentElement.offsetTop - currentElement.scrollTop;
            } while (currentElement = currentElement.parentElement);
            
            return {
                x: x,
                y: y
            };
        }

        function updatePos(xPos, bar, button) {
            var x = Math.max(Math.min(xPos, bar.offsetWidth - button.offsetWidth - 1), -1);
            button.style.left = x + 'px';
        }

        function updateRange(start, end, bar, range) {
            var left = Math.round(bar.clientWidth * start),
                right = Math.round(bar.clientWidth * end);

            range.style.left = left + 'px';
            range.style.width = (right - left) + 'px';
        }

        function barMousedown(event) {
            dragging = true;
            dragbar = this;
            innerbar = this.firstElementChild;
            dragbtn = this.lastElementChild;

            if(dragbtn === seekbtn) {
                resume = !audioanalyser.audio.paused;
            }

            barMousemove(event);

            event.preventDefault();
        }

        function barMousemove(event) {
            if(dragging) {
                updatePos(Math.round(getPos(event, dragbar).x - dragbtn.offsetWidth / 2 - 2), dragbar, dragbtn);

                if(dragbtn === seekbtn) {
                    seekMousemove(event);
                }

                if(dragbtn === volbtn) {
                    volumeMousemove(event);
                }
            }
        }

        function barMouseup() {
            if(dragbtn === seekbtn) {
                audioanalyser.emit('seeked', {
                    resume: resume
                });
            }

            dragging = false;
            dragbar = null;
            innerbar = null;
            dragbtn = null;
        }

        function seekMousemove(event) {
            var percent = (seekbtn.offsetLeft + 1) / (seekbar.offsetWidth - seekbtn.offsetWidth);

            updateRange(0, (seekbtn.offsetLeft + seekbtn.offsetWidth / 2) / seekbar.clientWidth, seekinner, played);

            audioanalyser.emit('seeking', {
                currentTime: Math.floor(Math.max(Math.min(percent, 1), 0) * audioanalyser.audio.duration)
            });
        }

        function volumeMousemove(event) {
            var percent = (volbtn.offsetLeft + 1) / (volbar.offsetWidth - volbtn.offsetWidth);

            updateRange(0, (volbtn.offsetLeft + volbtn.offsetWidth / 2) / volbar.clientWidth, volinner, volume);
            
            if(audioanalyser.gainNode) {
                audioanalyser.gainNode.gain.value = percent;
            }

            muted = false;

            if(percent > 0.5) {
                speaker.classList.remove('icon-volume-off', 'icon-volume-down');
                speaker.classList.add('icon-volume-up');
            } else if(percent > 0) {
                speaker.classList.remove('icon-volume-off', 'icon-volume-up');
                speaker.classList.add('icon-volume-down');
            } else {
                speaker.classList.remove('icon-volume-down', 'icon-volume-up');
                speaker.classList.add('icon-volume-off');
                muted = true;
            }

            lastVol = percent || 1;
        }

        toggle.addEventListener('click', function () {
            if(audioanalyser.audio.paused) {
                audioanalyser.play();
            } else {
                audioanalyser.pause();
            }
        });

        back.addEventListener('click', function () {
            audioanalyser.last();
        });

        skip.addEventListener('click', function () {
            audioanalyser.next();
        });

        speaker.addEventListener('click', function () {
            if(muted) {
                updatePos(lastVol * (volbar.offsetWidth - volbtn.offsetWidth) - 1, volbar, volbtn);
                audioanalyser.gainNode.gain.value = lastVol;

                if(lastVol > 0.5) {
                    speaker.classList.remove('icon-volume-off', 'icon-volume-down');
                    speaker.classList.add('icon-volume-up');
                } else {
                    speaker.classList.remove('icon-volume-off', 'icon-volume-up');
                    speaker.classList.add('icon-volume-down');
                }
            } else {
                updatePos(-1, volbar, volbtn);
                audioanalyser.gainNode.gain.value = 0;
                speaker.classList.remove('icon-volume-down', 'icon-volume-up');
                speaker.classList.add('icon-volume-off');
            }

            updateRange(0, (volbtn.offsetLeft + volbtn.offsetWidth / 2) / volbar.clientWidth, volinner, volume);
            muted = !muted;
        });

        audioanalyser.addEventListener('playing', function () {
            toggle.classList.add('icon-pause');
            toggle.classList.remove('icon-play');
        });

        audioanalyser.addEventListener('pause', function () {
            toggle.classList.add('icon-play');
            toggle.classList.remove('icon-pause');
        });

        audioanalyser.addEventListener('timeupdate', function () {
            var percent = audioanalyser.audio.currentTime / audioanalyser.audio.duration,
                xPos = Math.round((seekbar.offsetWidth - seekbtn.offsetWidth) * percent - 1);

            if(!audioanalyser.audio.paused) {
                updatePos(xPos, seekbar, seekbtn);
                updateRange(0, (seekbtn.offsetLeft + seekbtn.offsetWidth / 2) / seekbar.clientWidth, seekinner, played);
            }

            setTime(audioanalyser.audio.currentTime);
        });

        audioanalyser.addEventListener('progress', function () {
            if(audioanalyser.audio.buffered.length > 0) {
                var percentStart = audioanalyser.audio.buffered.start(0) / audioanalyser.audio.duration,
                    percentEnd = audioanalyser.audio.buffered.end(0) / audioanalyser.audio.duration;

                updateRange(percentStart, percentEnd, seekinner, buffered);
            }
        });

        seekbar.addEventListener('mousedown', barMousedown);

        volbar.addEventListener('mousedown', barMousedown);

        document.addEventListener('mousemove', barMousemove);

        document.addEventListener('mouseup', barMouseup);

        link.setAttribute('type', 'text/css');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('href', '/css/html5music.css');

        link.addEventListener('load', function () {
            setTime(0);

            updatePos(lastVol * (volbar.offsetWidth - volbtn.offsetWidth) - 1, volbar, volbtn);
            volumeMousemove();

            audioanalyser.initialize();
        });

        controls.setAttribute('style', settings.controls);

        controls.classList.add('audio');
        back.classList.add('back', 'icon-step-backward');
        toggle.classList.add('toggle', 'icon-play');
        skip.classList.add('skip', 'icon-step-forward');
        seekbar.classList.add('seekbar');
        seekinner.classList.add('innerbar');
        buffered.classList.add('buffered');
        played.classList.add('played');
        seekbtn.classList.add('seekbtn');
        time.classList.add('time');
        speaker.classList.add('speaker', 'icon-volume-up');
        volbar.classList.add('volbar');
        volinner.classList.add('innerbar');
        volume.classList.add('volume');
        volbtn.classList.add('volbtn');

        document.head.appendChild(link);

        controls.appendChild(back);
        controls.appendChild(toggle);
        controls.appendChild(skip);
        controls.appendChild(seekbar);
        controls.appendChild(time);
        controls.appendChild(speaker);
        controls.appendChild(volbar);

        seekbar.appendChild(seekinner);
        seekbar.appendChild(seekbtn);

        seekinner.appendChild(buffered);
        seekinner.appendChild(played);

        volbar.appendChild(volinner);
        volbar.appendChild(volbtn);

        volinner.appendChild(volume);

        container.appendChild(controls);
    }

    function getMaxSizeNeeded(canvas, effect) {
        switch(effect.position) {
        case 'topright':
        case 'topleft':
        case 'bottomright':
        case 'bottomleft':
        case 'horizontalright':
        case 'horizontalleft':
            return canvas.clientWidth / effect.size;
        case 'topmirror':
        case 'bottommirror':
        case 'horizontalmirror':
            return canvas.clientWidth / effect.size / 2;
        case 'leftdown':
        case 'leftup':
        case 'rightdown':
        case 'rightup':
        case 'verticaldown':
        case 'verticalup':
            return canvas.clientHeight / effect.size;
        case 'leftmirror':
        case 'rightmirror':
        case 'verticalmirror':
            return canvas.clientHeight / effect.size / 2;
        case 'horizontal':
            ///console.log(canvas.clientWidth);
            return canvas.clientWidth;
        case 'vertical':
            return canvas.clientHeight;
        }
    }

    var createScene = function(engine, canvas){
                // create a basic BJS Scene object
                var scene = new BABYLON.Scene(engine);

                // create a FreeCamera, and set its position to (x:0, y:5, z:-10)
                // var camera = new BABYLON.FreeCamera('camera1', new BABYLON.Vector3(0, 0,0), scene);

                // target the camera to scene origin
                //camera.setTarget(BABYLON.Vector3.Zero());

                // attach the camera to the canvas

                var arcCamera = new BABYLON.ArcRotateCamera("ArcRotateCamera", 1, .8, 10, new BABYLON.Vector3(0, 0, 0), scene);
                arcCamera.setPosition(new BABYLON.Vector3(0, -5, 15));
                arcCamera.target = new BABYLON.Vector3(0, 0, 0);
                // // attach the camera to the canvas
                // camera.attachControl(canvas, true);

                scene.activeCamera = arcCamera;
                arcCamera.attachControl(canvas, true);

                // for (i=0; i<D; i++){
                //     if (data[i] == 0){

                //     } else {
                //         path.push(data[i]);
                //     }
                // }
                // console.log(path);

                // create a basic light, aiming 0,1,0 - meaning, to the sky
                var light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(1,1,1), scene);
                // for(i = 0; i < path.length; i++) {
                //     // x = i;
                //     // y = 1;//data[i];
                //     // z = 2;
                //     var scale = .12
                //     var box = BABYLON.Mesh.CreateBox("box", scale, scene);
                //     box.position.x = -7+i*scale;
                //     if (path[i]<1){
                //         box.scaling.y = 1;
                //     } else {
                //         box.scaling.y = path[i];
                //     }
                //     //path.push(box);
                //     //path.push(new BABYLON.Vector3(x, y, z));
                // }




    //            var ribbon = BABYLON.Mesh.CreateRibbon("ribbon", path, false, false, 0, scene);

                // ribbon.position = new BABYLON.Vector3(-10, -10, 20);

                                //// clelie spiral
                              // // var spiralPath = [];
                              //   var a = 3;
                              //   var m = 5/4;
                              //   var pi2 = Math.PI * 2;
                              //   var step = pi2/100; // big determiner of size

                              //   // theta for angle; a for radius, m for shape
                              //   var clelie = function(theta ,a, m){
                              //       x = a * Math.sin(m*theta) * Math.cos(theta);
                              //       y = a * Math.sin(m*theta) * Math.sin(theta);
                              //       z = a * Math.cos(m*theta);
                              //       return new BABYLON.Vector3(x, y, z);
                              //   }

                              //   for (i = 0 ; i < data.length; i++){
                              //       if (clelie(0, a, m) === clelie(this.theta, a, m) && this.theta > 0){
                              //           //stop everything
                              //       } else{
                              //           this.path.push(clelie(this.theta, a, m));
                              //           this.theta = this.theta + step;
                              //       }
                              //   }
                              //   console.log(this.path);

                              //   var lines = BABYLON.Mesh.CreateLines("par", this.path, this.scene);

                // create a built-in "sphere" shape; its constructor takes 5 params: name, width, depth, subdivisions, scene
                //var sphere = BABYLON.Mesh.CreateSphere('sphere1', 16, 2, scene);

                // move the sphere upward 1/2 of its height
                // var plusOrMinus = Math.random() < 0.5 ? -1 : 1;
                // sphere.position.y = plusOrMinus * Math.floor((Math.random() * 4) + 1);
                // var plusOrMinus = Math.random() < 0.5 ? -1 : 1;
                // sphere.position.x = plusOrMinus * Math.floor((Math.random() * 4) + 1);

                // create a built-in "ground" shape; its constructor takes the same 5 params as the sphere's one
                //var ground = BABYLON.Mesh.CreateGround('ground1', 6, 6, 2, scene);

                // return the created scene
                return scene;
            }

    function Visualizer() {
        var self = this,
            canvas,
            effect;

        effect = settings.effects[0];
        //console.log(effect);
        // console.log(self.effect)

        self.audioanalyser = new AudioAnalyser();
        self.timeout = null;
        
        canvas = document.createElement('canvas');
        canvas.setAttribute('style', effect.style);
        // canvas.setAttribute('touch-action','none');
        self.context = canvas.getContext('webgl');
        // self.canvases = [];
        // self.contexts = [];
        self.size = null;
        //self.sizes = new Array(1);
        self.container = document.createElement('div');
        self.container.classList.add('music');
        self.container.setAttribute('style', settings.container);
        self.container.appendChild(canvas);
        
        self.z = 0;
        self.t = 0;
        // self.scenes = [];
        // self.paths = [];



        script.parentNode.insertBefore(self.container, script);

        // canvas = 
        // effect = settings.effects[i];
        // self.canvases.push(canvas);
        self.engine = new BABYLON.Engine(canvas, true);
        self.scene = createScene(self.engine, canvas);


        self.engine.runRenderLoop(function () {
            self.scene.render();
        });
        // self.contexts.push(c);
        // self.paths.push([-7]);

               //console.log(data);

        // call the createScene function
        // var scene = createScene(self.engine);
        // scene.render();           

        resize((function (canvas, effect) {
            return function () {
                canvas.width = canvas.clientWidth;
                //console.log(canvas.clientHeight);
                canvas.height = canvas.clientHeight;
                self.size = getMaxSizeNeeded(canvas, effect);
                //console.log("yo");
                };
            }(canvas, effect)));
        // };

        makeControls(self.audioanalyser, self.container);

        self.title = document.createElement('div');
        self.title.classList.add('title');
        self.title.setAttribute('style', settings.title);

        self.container.appendChild(self.title);

        self.audioanalyser.addEventListener('playing', function () {
            if(self.timeout === null) {
                self.timeout = setInterval(self.draw.bind(self), settings.frame);
                //self.clear;
            }
        });

        self.audioanalyser.addEventListener('title', function (data) {
            self.title.textContent = data.title;
        });

        // self.audioanalyser.addEventListener('ended', function (){
        //     console.log(self.all);
        // })

        // self.all = [];
    };

    // Visualizer.prototype.clear = function () {
    //     engines[0].stopRenderLoop();
    //     engines[0].clear(BABYLON.Color3.Black(),false,false);
    //     //if (engine.scenes.length!==0) {    //if more than 1 scene, while(engine.scenes.length>0) {    engine.scenes[0].dispose();}

    // };

    Visualizer.prototype.draw = function () {
        //this.clear();
        // console.log("hello")
        /* if audio is paused, cancel interval and clear canvases */
        if(this.audioanalyser.audio.paused) {
            clearInterval(this.timeout);
            this.timeout = null;
            return;
        }

        var analyser = this.audioanalyser.analyser,
            timeSize = Math.min(analyser.fftSize, this.size),
            freqSize = Math.min(analyser.frequencyBinCount, this.size),
            timeData = new Uint8Array(timeSize),
            freqData = new Uint8Array(freqSize),
            i;

        // console.log(this.sizes);
        //console.log(freqData);

        analyser.getByteTimeDomainData(timeData);
        analyser.getByteFrequencyData(freqData);

        var data = timeData;

        var topPath = [];
        // var bottomPath = [];
        // for (i = 0; i < data.length; i++){
        //     var x = i - 7;
        //     topPath.push(new BABYLON.Vector3(x,timeData[i]/100,this.z));
        //     bottomPath.push(new BABYLON.Vector3(x,0,this.z));
        // }
        // this.z = this.z + 1;

        var spiralPath = [];
        var parallelSpiralPath = [];
        var parallelTopPath = [];
        var a = .01;
        // var b = .09;
        var pi2 = Math.PI * 2;
        var step = pi2 / 360; // big determiner of size
        for (i = 0; i < data.length; i++){
            var x = a * this.t * Math.cos(this.t);
            var y = a * this.t * Math.sin(this.t);
            spiralPath.push(new BABYLON.Vector3(x,y,0));
            // console.log(this.t);
            // if (this.t > pi2){
            topPath.push(new BABYLON.Vector3(x,y,data[i]/50));
            // } else {
            //     topPath.push(new BABYLON.Vector3(x,y,data[i]/50));                
            // }
            x = x - .1 * Math.cos(this.t);
            y = y - .1 * Math.sin(this.t);
            parallelSpiralPath.push(new BABYLON.Vector3(x,y,0));
            parallelTopPath.push(new BABYLON.Vector3(x,y,data[i]/50));
            this.t = this.t + step;
        }
        this.t = this.t - step;

        //var materialSphere1 = new BABYLON.StandardMaterial("texture1", this.scene);
        //materialSphere1.wireframe = true;   

        // var ribbon = BABYLON.Mesh.CreateRibbon("ribbon", [topPath, spiralPath], false, false, 0, this.scene);

        var ribbon = BABYLON.Mesh.CreateRibbon("ribbon", [topPath, parallelTopPath, parallelSpiralPath,spiralPath], false, false, 0, this.scene);

        //ribbon.material = materialSphere1;
        // var cylinder = BABYLON.Mesh.CreateCylinder("cylinder", 3, 3, 3, 0, 1, this.scene);

        //var lines = BABYLON.Mesh.CreateLines("par", spiralPath, this.scene);
        //var lines = BABYLON.Mesh.CreateLines("par", parallelSpiralPath, this.scene);

        //var sphere = BABYLON.Mesh.CreateSphere("sphere", Math.random()*10, 10.0, this.scene);

        // console.log(freqData);

        // console.log(timeData);



    //     for(i = 0; i < settings.effects.length; i++) {
    //         switch(settings.effects[i].type) {
    //         // case 'fft':
    //         //     Visualizer.drawFFT(settings.effects[i], this.canvases[i], this.contexts[i], freqData);
    //         //     break;
    //         // case 'waveform':
    //         //     Visualizer.drawWaveform(settings.effects[i], this.canvases[i], this.contexts[i], timeData);
    //         //     break;
    //         case '3d':
    //             //console.log(this.audioanalyser.settings.audio);
    //             Visualizer.draw3d(settings.effects[i], this.canvas, this.context, this.scene, freqData, null);
    //             break;
    //         }
    //     }
    // };


    // Visualizer.draw3d = function(effect, canvas, context, scene, data, path) {
    //     // var W = canvas.width,
    //     //     H = canvas.height,
    //     //     D = data.length,
    //     //     i = 0;

    //     scene.render();

 

        // run the render loop
        // engine.runRenderLoop(function(){
        //     scene.render();
        // });


    }

    try {
        settings = JSON.parse(script.textContent.trim()||'{}');
        new Visualizer();
    } catch(error) {
        console.log(error);
        return;
    }
})();
