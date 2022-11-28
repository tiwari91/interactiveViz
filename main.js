$(document).ready(function() {


    var width = $(window).height(),
        height = $(window).width();

    var projection = d3.geo.mercator()
        .scale([width * 5.3])
        .translate([width, height / 2])
        .center([-120, 36]);


    var path = d3.geo.path()
        .projection(projection);


    var svg = d3.select("body").append("svg")
        .attr("width", width)
        .attr("height", height);


    //tooltip declaration
    var div = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);


    queue()
        .defer(d3.json, 'data/ca.json')
        .defer(d3.csv, 'data/reservoir_filtered_data.csv')
        .defer(d3.csv, 'data/reservoir_dis_link.csv')
        .await(function(error, ca, reservoirs, reservoir_dis) {

            var g = svg.append("g");
            
            var bckGrndLine, animatedLine;

            g.append("path")
                .datum(topojson.mesh(ca, ca.objects.counties, function(a, b) {
                    return a === b;
                }))
                .attr("d", path)
                .attr("class", "exterior-boundary");

            g.selectAll(".county")
                .data(topojson.feature(ca, ca.objects.counties).features)
                .enter().append("path")
                .attr("class", function(d) {
                    return "county " + d.properties.name;
                })
                .attr("d", path)
                .on("mouseover", function(d) {

                    if (d.properties.fullName === "Shasta County") {
                        g.selectAll("circle")
                            .transition()
                            .duration(3000)
                            .attr("r", 15);

                        g.selectAll(".bckGrndLine")
                            .transition()
                            .duration(2000)
                            .attr("opacity", .2)
                            .attr('stroke-width', 3);

                        g.selectAll(".animatedLine")
                            .transition()
                            .duration(2000)
                            .ease("linear")
                            .attr('stroke-width', 4)
                            .attrTween("stroke-dasharray", function() {
                                var len = this.getTotalLength();
                                lt = len;
                                return function(t) {
                                    return (d3.interpolateString("0," + len, len + ",0"))(t)
                                };
                            });
                    }

                    div.transition()
                        .duration(1000)
                        .style("opacity", .9);

                    div.html(d.properties.fullName)
                        .style("left", (d3.event.pageX) + 10 + "px")
                        .style("top", (d3.event.pageY - 30) + "px");
                })
                .on("mouseout", function(d) {
                    
                   if (d.properties.fullName === "Shasta County") {
                        g.selectAll("circle")
                            .transition()
                            .duration(3000)
                            .attr("r", 5);

                        g.selectAll(".bckGrndLine")
                            .transition()
                            .duration(2000)
                            .attr('stroke-width', 1);

                        g.selectAll(".animatedLine")
                            .transition()
                            .duration(2000)
                            .attr('stroke-width', 1)
                            .attrTween("stroke-dasharray", function() {
                                var len = this.getTotalLength();
                                lt = len;
                                return function(t) {
                                    return (d3.interpolateString("0," + len, len + ",0"))(t)
                                };
                            });
                    }

                    div.transition()
                        .duration(500)
                        .style("opacity", 0.0);
                });

            svg.append("text")
                .attr('x', 1)
                .attr('y', 20)
                .style("fill", "white")
                .attr('class', 'yearDate');

            //reservoirsinfo
            var displaySites = function(reservoirs) {

                var reservoirDates,

                    reserData = reservoirs.map(function(d, i) {

                        reservoirDates = d3.keys(d).filter(function(key) {
                            if (key === 'Station' || key === 'ID' || key === 'Elev' || key === 'Latitude' || key === 'Longitude' ||
                                key === 'County' || key === 'Nat_ID' || key === 'Year_Built' || key === 'Capacity') {
                                return false;
                            }
                            return true;
                        });

                        var reserDateValues = reservoirDates.map(function(date) {
                            if (d[date] === "") {
                                return 0;
                            } else {
                                return +d[date];
                            }
                        });

                        return {
                            dates: reserDateValues,
                            Station: d['Station'],
                            ID: d['ID'],
                            Elev: +d['Elev'],
                            lat: +d['Latitude'],
                            lng: +d['Longitude'],
                            County: d['County'],
                            Nat_ID: d['Nat_ID'],
                            Year_Built: +d['Year_Built'],
                            Capacity: +d['Capacity']
                        };
                    });

                g.attr('class', 'reservoirs').selectAll(".reserCircles")
                    .data(reserData)
                    .enter()
                    .append("circle")
                    .attr("r", 5)
                    .attr('cx', function(d) {
                        return projection([d.lng, d.lat])[0];
                    })
                    .attr('cy', function(d) {
                        return projection([d.lng, d.lat])[1];
                    })
                    .on("mouseover", function(d) {
                        div.transition()
                            .duration(200)
                            .style("opacity", .9);

                        div.html(reservoirInfo(d))
                            .style("left", (d3.event.pageX) + 10 + "px")
                            .style("top", (d3.event.pageY - 30) + "px");

                    })
                    .on("mouseout", function(d) {
                        div.transition()
                            .duration(500)
                            .style("opacity", 0.0);
                    });

                function reservoirInfo(d) {
                    var info = d;
                    var reserContent = "<strong> Name:  </strong> <span style='color:red'>" + info.Station + "</span>" + "<br>" +
                        "<strong> County:  </strong> <span style='color:red'>" + info.County + "</span>" + "<br>" +
                        "<strong> Elevation:  </strong> <span style='color:red'>" + info.Elev + "</span>" + "<br>" +
                        "<strong> Year Built:  </strong> <span style='color:red'>" + info.Year_Built + "</span>" + "</span>"
                    return reserContent;
                }
            };

            //river stream
            var displayStreams = function(reservoir_dis) {

                var riverDate,

                    river_parsed = reservoir_dis.map(function(d, i) {
                        riverDate = d3.keys(d).filter(function(key) {
                            if (key === 'Station' || key === 'ID' || key === 'Elev' || key === 'Dest_Lat' || key === 'Dest_Lon' ||
                                key === 'County' || key === 'StationID' || key === 'RiverBasin' || key === 'Source_Latitude' || key === 'Source_Longitude') {
                                return false;
                            }
                            return true;
                        });

                        var riverDateValues = riverDate.map(function(date) {
                            if (d[date] === "") {
                                return 0;
                            } else {
                                return +d[date];
                            }
                        });

                        return {
                            riverdates: riverDateValues,
                            sourcelat: +d['Source_Latitude'],
                            sourcelng: +d['Source_Longitude'],
                            destlat: +d['Dest_Lat'],
                            destlng: +d['Dest_Lon']
                        };
                    }),

                    lineArray = d3.svg.line()
                    .x(function(d) {
                        return d[0];
                    })
                    .y(function(d) {
                        return d[1];
                    })
                    .interpolate("basis"),

                    riverlinearScale = d3.scale.linear()
                    .range([0.5, 3])
                    .domain([0, 38000]);

                svg.select('.yearDate')
                    .text(function(d, i) {
                        return riverDate;
                    });

                backgrndLine();

                function backgrndLine() {
                    bckGrndLine = g.selectAll(".bckGrndLine")
                        .data(river_parsed)
                        .enter()
                        .append("path")
                        .attr("class", "bckGrndLine")
                        .attr("d", irgBckGrndLine)
                        .attr('stroke-width', .3)
                        .attr("opacity", .2)
                        .attr("stroke-linejoin", "round")
                        .attr("stroke-linecap", "round")
                        .style("stroke", "#95CEEC")
                        .style("shape-rendering", "crispEdges");

                }

                function irgBckGrndLine(c) {
                    var source = projection([c.sourcelng, c.sourcelat]),
                        target = projection([c.destlng, c.destlat]),
                        dx = target[0] - source[0],
                        dy = target[1] - source[1],
                        angle = Math.atan(dy / dx), //returns angle
                        dist = Math.sqrt(dx * dx + dy * dy); //distance between two lnCrdints

                    var lnCrd = [source],
                        N = 18;

                    for (var i = 0; i < N; i++) {
                        //for irregularity in angle
                        var rndAngle = i % 2 ? -Math.random() + angle : Math.random() + angle,
                            moveX = dist / (N - 1) * Math.cos(rndAngle),
                            moveY = dist / (N - 1) * Math.sin(rndAngle);

                        //makes sure line moves in correct axis direction
                        if (dx > dy && target[0] < source[0]) {
                            // moves coordinates (lnCrd[lnCrd.length - 1][0] )by (linedistance/N) -> ((d / (N - 1)) along  angle(rA)
                            var nX = lnCrd[lnCrd.length - 1][0] - (moveX); //lnCrd[lnCrd.length - 1][0] returns source[0][0]
                            var nY = lnCrd[lnCrd.length - 1][1] - (moveY);
                        } else if (dy > dx && target[1] < source[1]) {
                            var nX = lnCrd[lnCrd.length - 1][0] - (moveX);
                            var nY = lnCrd[lnCrd.length - 1][1] - (moveY);
                        } else if (dx < dy && target[0] > source[0]) {
                            var nX = lnCrd[lnCrd.length - 1][0] + (moveX);
                            var nY = lnCrd[lnCrd.length - 1][1] + (moveY);
                        } else if (dx < dy && target[1] > source[1]) {
                            var nX = lnCrd[lnCrd.length - 1][0] - (moveX);
                            var nY = lnCrd[lnCrd.length - 1][1] - (moveY);
                        } else {
                            var nX = lnCrd[lnCrd.length - 1][0] + (moveX);
                            var nY = lnCrd[lnCrd.length - 1][1] + (moveY);
                        }

                        lnCrd.push([nX, nY]);
                    }

                    lnCrd.push(target);
                    return lineArray(lnCrd);
                }

                streams();

                function streams() {
                    animatedLine = g.selectAll(".animatedLine")
                        .data(river_parsed)
                        .enter()
                        .append("path")
                        .attr("class", "animatedLine")
                        .attr("d", irgLine)
                        .attr("stroke-linejoin", "round")
                        .attr("stroke-linecap", "round")
                        .attr("opacity", 1)
                        .style("stroke", "#95CEEC")
                        .style("shape-rendering", "crispEdges");
                }

                function irgLine(c) {
                    var source = projection([c.sourcelng, c.sourcelat]),
                        target = projection([c.destlng, c.destlat]),
                        dx = target[0] - source[0],
                        dy = target[1] - source[1],
                        angle = Math.atan(dy / dx), //returns angle
                        dist = Math.sqrt(dx * dx + dy * dy); //distance between two lnCrdints

                    var lnCrd = [source],
                        N = 18;

                    for (var i = 0; i < N; i++) {
                        //for irregularity in angle
                        var rndAngle = i % 2 ? -Math.random() + angle : Math.random() + angle,
                            moveX = dist / (N - 1) * Math.cos(rndAngle),
                            moveY = dist / (N - 1) * Math.sin(rndAngle);

                        //makes sure line moves in correct axis direction
                        if (dx > dy && target[0] < source[0]) {
                            // moves coordinates (lnCrd[lnCrd.length - 1][0] )by (linedistance/N) -> ((d / (N - 1)) along  angle(rA)
                            var nX = lnCrd[lnCrd.length - 1][0] - (moveX); //lnCrd[lnCrd.length - 1][0] returns source[0][0]
                            var nY = lnCrd[lnCrd.length - 1][1] - (moveY);
                        } else if (dy > dx && target[1] < source[1]) {
                            var nX = lnCrd[lnCrd.length - 1][0] - (moveX);
                            var nY = lnCrd[lnCrd.length - 1][1] - (moveY);
                        } else if (dx < dy && target[0] > source[0]) {
                            var nX = lnCrd[lnCrd.length - 1][0] + (moveX);
                            var nY = lnCrd[lnCrd.length - 1][1] + (moveY);
                        } else if (dx < dy && target[1] > source[1]) {
                            var nX = lnCrd[lnCrd.length - 1][0] - (moveX);
                            var nY = lnCrd[lnCrd.length - 1][1] - (moveY);
                        } else {
                            var nX = lnCrd[lnCrd.length - 1][0] + (moveX);
                            var nY = lnCrd[lnCrd.length - 1][1] + (moveY);
                        }

                        lnCrd.push([nX, nY]);
                    }

                    lnCrd.push(target);
                    return lineArray(lnCrd);
                }

                river_parsed[0].riverdates.forEach(function(d, i) {
                    setTimeout(function() {
                        changeStrokeWidth(i);
                    }, i * 4000);
                });


                function changeStrokeWidth(index) {

                    var lt;

                    animatedLine.style("opacity", 1)
                        .transition()
                        .duration(4000)
                        .ease("linear")
                        .style("opacity", 1)
                        .attr('stroke-width', function(d) {
                            return riverlinearScale(d.riverdates[index]);
                        })
                        .attrTween("stroke-dasharray", function() {
                            var len = this.getTotalLength();
                            lt = len;
                            return function(t) {
                                return (d3.interpolateString("0," + len, len + ",0"))(t)
                            };
                        });
                }

            };

            displaySites(reservoirs);

            displayStreams(reservoir_dis);

            zoom();

            //zoom
            function zoom() {
                // zoom and pan
                var zoom = d3.behavior.zoom()
                    .on("zoom", function() {
                        g.attr("transform", "translate(" +
                            d3.event.translate.join(",") + ")scale(" + d3.event.scale + ")");
                    });

                svg.call(zoom);
            };


        });


});